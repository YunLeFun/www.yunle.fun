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

const { generateDefaultNickname } = require('./displayName')
const { isMembershipActive } = require('./lib/membership')
const { MEMBERSHIPS_COLLECTION } = require('./lib/orders')

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
function toPublicProfile(doc, userId, isMember = false) {
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
    isMember: !!isMember,
  }
}

/**
 * 批量计算公开会员标记。规范 `_id == uid` 文档优先；仅存在历史 userId 文档时，
 * 只要任一记录仍有效即视为会员。查询失败统一降级为空 Map，不影响公开资料主链路。
 */
async function fetchPublicMembershipsByIds(db, ids, now = Date.now()) {
  const normalizedIds = [...new Set((Array.isArray(ids) ? ids : [])
    .filter(id => typeof id === 'string' && id))]
  const statuses = new Map()
  if (!normalizedIds.length)
    return statuses

  try {
    const idSet = new Set(normalizedIds)
    const legacyLimit = Math.min(normalizedIds.length * 10, 1000)
    const [canonicalResult, legacyResult] = await Promise.all([
      db
        .collection(MEMBERSHIPS_COLLECTION)
        .where({ _id: db.command.in(normalizedIds) })
        .limit(normalizedIds.length)
        .get(),
      db
        .collection(MEMBERSHIPS_COLLECTION)
        .where({ userId: db.command.in(normalizedIds) })
        .limit(legacyLimit)
        .get(),
    ])

    for (const membership of (Array.isArray(legacyResult?.data) ? legacyResult.data : [])) {
      if (idSet.has(membership?.userId) && isMembershipActive(membership.expireAt, now))
        statuses.set(membership.userId, true)
    }
    // 规范文档是最终真相源，覆盖可能残留的历史记录。
    for (const membership of (Array.isArray(canonicalResult?.data) ? canonicalResult.data : [])) {
      if (idSet.has(membership?._id))
        statuses.set(membership._id, isMembershipActive(membership.expireAt, now))
    }
  }
  catch (error) {
    console.error('[profiles] 公开会员状态批量读取失败，降级隐藏角标:', error)
    return new Map()
  }
  return statuses
}

async function projectPublicProfile(db, doc, userId, now) {
  const memberships = await fetchPublicMembershipsByIds(db, [userId], now)
  return toPublicProfile(doc, userId, memberships.get(userId) === true)
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
    // 旧版软注销只改 user_profiles、未删 Auth，导致用户再次登录后把资料写活，
    // 但 GitHub / 手机等认证绑定仍被旧 uid 占用。最终注销一旦开始，禁止任何资料复活。
    if (existing.deletedAt)
      throw new Error('账号已注销，不能再更新公开资料')
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
  return projectPublicProfile(db, after, uid, now)
}

/**
 * 公开读取用户资料（按 uid 或 login）。不存在返回 null。
 *
 * @param {object} db
 * @param {object} [input]
 * @param {string} [input.userId] uid（优先）
 * @param {string} [input.login] 用户名
 * @param {number} [input.now]
 * @returns {Promise<object|null>} 公开资料，不存在返回 null
 */
async function getProfile(db, { userId, login, now = Date.now() } = {}) {
  if (userId) {
    const uid = assertUserId(userId)
    const doc = await readProfileDoc(db, uid)
    return doc ? projectPublicProfile(db, doc, uid, now) : null
  }
  if (login && typeof login === 'string') {
    const { data } = await db
      .collection(USER_PROFILES_COLLECTION)
      .where({ login: login.trim() })
      .limit(1)
      .get()
    const doc = Array.isArray(data) && data.length > 0 ? data[0] : null
    return doc ? projectPublicProfile(db, doc, doc._id, now) : null
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
 * @param {number} [now]
 * @returns {Promise<Map<string, object>>} uid → 资料文档
 */
async function fetchProfilesByIds(db, ids, now = Date.now()) {
  const map = new Map()
  if (!Array.isArray(ids) || !ids.length)
    return map
  const [{ data }, memberships] = await Promise.all([
    db
      .collection(USER_PROFILES_COLLECTION)
      .where({ _id: db.command.in(ids) })
      .limit(ids.length)
      .get(),
    fetchPublicMembershipsByIds(db, ids, now),
  ])
  for (const p of (Array.isArray(data) ? data : []))
    map.set(p._id, { ...p, isMember: memberships.get(p._id) === true })
  return map
}

/** 回填默认昵称：单批默认 / 上限规模 */
const BACKFILL_DEFAULT_LIMIT = 100
const BACKFILL_MAX_LIMIT = 500

/**
 * 运维回填（内部 action，需 ACCOUNT_API_INTERNAL_TOKEN）：把存量 user_profiles 中
 * 「昵称为空 / 裸手机号」的文档批量补成品牌默认名「云游者_xxxx」。
 *
 * 解决历史问题：早期登录用户的昵称被 pickProfileFields 当手机号过滤成空，别人看到 fallback
 * 「云乐坊用户」无辨识度。回填后展示面立即体面，且与前端登录写回 **同一算法、同 uid 同名**，
 * 不会冲突（用户之后登录前端再写一遍也是同一个名）。
 *
 * 安全护栏：
 *  - **幂等**：只处理昵称为空 / 裸手机号的文档；已设真实昵称的跳过；重复跑安全。
 *  - **跳过已注销**：deletedAt 存在的软注销用户不回填（资料已脱敏，不应复活展示名）。
 *  - **dryRun**：只统计命中量、不写库，先摸清规模。
 *  - **游标分批**：按 _id 升序 + cursor，避免大集合单次超时；运维循环调用至 done。
 *
 * @param {object} db
 * @param {object} [input]
 * @param {string} [input.cursor] 上一批返回的 nextCursor；首批留空
 * @param {number} [input.limit]  单批扫描条数（默认 100，上限 500）
 * @param {boolean} [input.dryRun] 只统计不写库
 * @param {number} [input.now]
 * @returns {Promise<{scanned:number, updated:number, skipped:number, nextCursor:string, done:boolean, dryRun:boolean}>}
 */
async function backfillDefaultNicknames(db, { cursor = '', limit = BACKFILL_DEFAULT_LIMIT, dryRun = false, now = Date.now() } = {}) {
  const lim = Math.min(Math.max(Number(limit) || BACKFILL_DEFAULT_LIMIT, 1), BACKFILL_MAX_LIMIT)
  const col = db.collection(USER_PROFILES_COLLECTION)
  let query = col.orderBy('_id', 'asc')
  if (cursor)
    query = query.where({ _id: db.command.gt(cursor) })
  const { data } = await query.limit(lim).get()
  const docs = Array.isArray(data) ? data : []

  let updated = 0
  let skipped = 0
  for (const doc of docs) {
    const nn = doc.nickname
    const isEmpty = nn === undefined || nn === null || (typeof nn === 'string' && nn.trim() === '')
    // 已注销用户不复活展示名；仅空 / 裸手机号才回填，真实昵称一律保留
    const needs = !doc.deletedAt && (isEmpty || isPhoneLikeNickname(nn))
    if (!needs) {
      skipped++
      continue
    }
    if (!dryRun) {
      await col.doc(doc._id).update({
        nickname: generateDefaultNickname(doc._id),
        updatedAt: now,
      })
    }
    updated++
  }

  return {
    scanned: docs.length,
    updated,
    skipped,
    nextCursor: docs.length ? docs[docs.length - 1]._id : cursor,
    done: docs.length < lim,
    dryRun: !!dryRun,
  }
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
  backfillDefaultNicknames,
}
