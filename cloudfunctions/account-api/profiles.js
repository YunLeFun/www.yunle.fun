/**
 * 用户公开资料 user_profiles（account-api 本地模块，非同步 lib）。
 *
 * 背景：用户身份源是 CloudBase 内置 Auth，资料（昵称 / 头像 / 用户名）存在 user_metadata，
 * 前端 SDK 只能取「自己」，云函数无法按任意 uid 批量读他人资料。关注 / 粉丝、未来的
 * 评论 / 点赞 / @ 都需要「uid → 公开资料」映射，故落一张去规范化资料表：
 *   - `_id` 即 uid（doc(uid) 主键查询立即一致、无索引延迟）
 *   - 资料字段（login / nickname / avatar / description）由本人登录或改资料后 upsert（白名单）
 *   - 计数字段（followersCount / followingCount）只由 follows.js 维护，本人 upsert 不可改
 *
 * 资料是 CloudBase Auth 的最终一致缓存：用户改了昵称但未触发 upsert 时会短暂滞后，可接受。
 */

'use strict'

const USER_PROFILES_COLLECTION = 'user_profiles'

/** 资料计数并发冲突最大重试次数（沿用 tips/wallet 的 CAS 策略） */
const PROFILE_STATS_MAX_RETRY = 5

/** 用户名规则：与前端 useAuthCore 的 RE_USERNAME 保持一致 */
const RE_LOGIN = /^[a-z][\w-]{2,19}$/i
const NICKNAME_MAX = 40
const DESCRIPTION_MAX = 200
const AVATAR_MAX = 512

/**
 * 中国大陆手机号：11 位、1[3-9] 开头。
 * 手机 OTP 用户在 CloudBase 的 auth 默认昵称（user_metadata.nickName）就是完整手机号，
 * 前端登录时会把它同步上来。user_profiles 是「展示给他人」的公开基建，绝不能落手机号 PII，
 * 故识别出这种「裸手机号昵称」后按未提供处理（见 pickProfileFields）。
 */
const RE_PHONE_LIKE = /^1[3-9]\d{9}$/
function isPhoneLikeNickname(s) {
  return typeof s === 'string' && RE_PHONE_LIKE.test(s.trim())
}

/** 校验并归一 userId（非空字符串） */
function assertUserId(userId) {
  if (typeof userId !== 'string' || !userId.trim())
    throw new Error('userId 必须为非空字符串')
  return userId.trim()
}

/**
 * 裁剪字符串到上限。
 * @returns {string|undefined} 非字符串入参返回 undefined（表示「本次不更新该字段」）
 */
function clampStr(v, max) {
  if (typeof v !== 'string')
    return undefined
  return v.trim().slice(0, max)
}

/**
 * 提取「本人可写」的白名单资料字段。计数字段一律忽略（防刷自己粉丝数）。
 * 仅返回「显式传入」的字段，避免把未传字段覆盖为空。
 */
function pickProfileFields(input) {
  const out = {}
  if (!input || typeof input !== 'object')
    return out

  const login = clampStr(input.login, 20)
  if (login !== undefined) {
    if (login && !RE_LOGIN.test(login))
      throw new Error('用户名格式不正确：3-20 个字符，以字母开头，仅限字母、数字、下划线和连字符')
    out.login = login || null
  }
  // 昵称：把「裸手机号昵称」（auth 默认值）视为未提供——既不写入 PII，
  // 也不会覆盖用户后来在设置里改过的真实昵称（真实昵称经 auth.updateUser 同步上来，不是手机号）。
  const nickname = clampStr(input.nickname, NICKNAME_MAX)
  if (nickname !== undefined && !isPhoneLikeNickname(nickname))
    out.nickname = nickname
  const avatar = clampStr(input.avatar, AVATAR_MAX)
  if (avatar !== undefined)
    out.avatar = avatar || null
  const description = clampStr(input.description, DESCRIPTION_MAX)
  if (description !== undefined)
    out.description = description
  // 隐私开关（布尔白名单）：是否隐藏粉丝 / 关注列表
  if (typeof input.hideFollowers === 'boolean')
    out.hideFollowers = input.hideFollowers
  if (typeof input.hideFollowing === 'boolean')
    out.hideFollowing = input.hideFollowing
  // 通知偏好（布尔白名单）：是否接收「被关注」通知
  if (typeof input.notifyOnFollow === 'boolean')
    out.notifyOnFollow = input.notifyOnFollow
  return out
}

/** 公开资料投影（对外只暴露这些字段） */
function toPublicProfile(doc, userId) {
  return {
    userId,
    login: doc?.login || null,
    nickname: doc?.nickname || '',
    avatar: doc?.avatar || null,
    description: doc?.description || '',
    followersCount: doc?.followersCount || 0,
    followingCount: doc?.followingCount || 0,
    hideFollowers: !!doc?.hideFollowers,
    hideFollowing: !!doc?.hideFollowing,
    // 通知偏好：缺省视为开启（仅显式 false 才关闭）
    notifyOnFollow: doc?.notifyOnFollow !== false,
  }
}

/** 读单个 profile 文档（按 uid 主键），不存在返回 null。兼容 doc().get() 返回数组 / 对象两种形态 */
async function readProfileDoc(db, uid) {
  const { data } = await db.collection(USER_PROFILES_COLLECTION).doc(uid).get()
  return Array.isArray(data) ? (data[0] || null) : (data || null)
}

/** 构造占位 / 初始 profile 文档（计数为 0，资料字段空，等本人 upsert 补全） */
function blankProfile(uid, now, overrides = {}) {
  return {
    _id: uid,
    login: null,
    nickname: '',
    avatar: null,
    description: '',
    followersCount: 0,
    followingCount: 0,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

/**
 * 本人 upsert 自己的公开资料（白名单字段，不含计数）。
 *
 * @param {object} db
 * @param {object} input
 * @param {string} input.userId
 * @param {object} input.profile  { login?, nickname?, avatar?, description? }
 * @param {number} [input.now]
 * @returns {Promise<object>} 最新公开资料
 */
async function upsertMyProfile(db, { userId, profile, now = Date.now() }) {
  const uid = assertUserId(userId)
  const fields = pickProfileFields(profile)
  const existing = await readProfileDoc(db, uid)

  if (existing) {
    await db.collection(USER_PROFILES_COLLECTION).doc(uid).update({ ...fields, updatedAt: now })
  }
  else {
    await db.collection(USER_PROFILES_COLLECTION).add(blankProfile(uid, now, {
      login: fields.login ?? null,
      nickname: fields.nickname ?? '',
      avatar: fields.avatar ?? null,
      description: fields.description ?? '',
    }))
  }

  const after = await readProfileDoc(db, uid)
  return toPublicProfile(after, uid)
}

/**
 * 公开读取用户资料（按 uid 或 login）。不存在返回 null。
 *
 * @param {object} db
 * @param {object} [input]
 * @param {string} [input.userId] uid（优先）
 * @param {string} [input.login] 用户名
 * @returns {Promise<object|null>} 公开资料，不存在返回 null
 */
async function getProfile(db, { userId, login } = {}) {
  if (userId) {
    const uid = assertUserId(userId)
    const doc = await readProfileDoc(db, uid)
    return doc ? toPublicProfile(doc, uid) : null
  }
  if (login && typeof login === 'string') {
    const { data } = await db
      .collection(USER_PROFILES_COLLECTION)
      .where({ login: login.trim() })
      .limit(1)
      .get()
    const doc = Array.isArray(data) && data.length > 0 ? data[0] : null
    return doc ? toPublicProfile(doc, doc._id) : null
  }
  return null
}

/**
 * 累加某用户的关注计数（CAS 乐观锁）。profile 不存在则创建占位，等本人登录补全资料。
 * 计数不会被减成负数。供 follows.js 维护双方 followersCount / followingCount。
 *
 * @param {object} db
 * @param {object} input
 * @param {string} input.userId
 * @param {'followersCount'|'followingCount'} input.field
 * @param {number} input.delta  +1 / -1
 * @param {number} [input.now]
 */
async function bumpFollowCount(db, { userId, field, delta, now = Date.now() }) {
  const uid = assertUserId(userId)
  if (field !== 'followersCount' && field !== 'followingCount')
    throw new Error(`非法计数字段: ${field}`)

  for (let attempt = 0; attempt < PROFILE_STATS_MAX_RETRY; attempt++) {
    const cur = await readProfileDoc(db, uid)

    if (!cur) {
      try {
        await db.collection(USER_PROFILES_COLLECTION).add(blankProfile(uid, now, {
          [field]: Math.max(0, delta),
        }))
        return
      }
      catch {
        // 并发创建撞主键：重读走 update 分支
        continue
      }
    }

    const next = Math.max(0, (cur[field] || 0) + delta)
    const result = await db
      .collection(USER_PROFILES_COLLECTION)
      .where({ _id: uid, version: cur.version })
      .update({ [field]: next, version: (cur.version || 1) + 1, updatedAt: now })
    const updated = result?.updated ?? result?.modifiedCount ?? 0
    if (updated > 0)
      return
    // 被并发改写，重读重试
  }
  throw new Error('user_profiles 计数并发冲突，请重试')
}

/**
 * 批量取用户公开资料，返回 Map<uid, profileDoc>。供关注列表 / Feed join 展示用。
 *
 * @param {object} db
 * @param {string[]} ids
 * @returns {Promise<Map<string, object>>} uid → 资料文档
 */
async function fetchProfilesByIds(db, ids) {
  const map = new Map()
  if (!Array.isArray(ids) || !ids.length)
    return map
  const { data } = await db
    .collection(USER_PROFILES_COLLECTION)
    .where({ _id: db.command.in(ids) })
    .limit(ids.length)
    .get()
  for (const p of (Array.isArray(data) ? data : []))
    map.set(p._id, p)
  return map
}

module.exports = {
  USER_PROFILES_COLLECTION,
  assertUserId,
  pickProfileFields,
  toPublicProfile,
  readProfileDoc,
  upsertMyProfile,
  getProfile,
  bumpFollowCount,
  fetchProfilesByIds,
}
