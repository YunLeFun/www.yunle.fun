/**
 * 用户关注关系 user_follows（account-api 本地模块，非同步 lib）。
 *
 * 单向关注（微博 / B 站式）：A 关注 B → A 是 B 的粉丝，互相关注 = 互关。
 * 关系明细 user_follows 是最终真相源；user_profiles 上的 followersCount / followingCount
 * 是去规范化计数（CAS 维护，漂移可由明细重算）。整体与投币 tips.js 同构。
 *
 * 幂等：(followerId, followingId) 联合唯一索引 —— 重复关注不重复计数；
 * 取关对不存在的关系是 no-op（不报错、不减计数）。
 *
 * 计数为跨两文档更新（关注方 followingCount + 被关注方 followersCount），非原子；
 * 极端失败可能漂移，以 user_follows 为真相源由对账脚本重算（见 cloudfunctions/README）。
 */

'use strict'

const { createFollowNotification } = require('./notifications')
const {
  assertUserId,
  bumpFollowCount,
  fetchProfilesByIds,
  readProfileDoc,
  resolvePublicNickname,
} = require('./profiles')

const USER_FOLLOWS_COLLECTION = 'user_follows'

/** 查询某条关注关系（存在返回文档，否则 null） */
async function findFollow(db, { followerId, followingId }) {
  const { data } = await db
    .collection(USER_FOLLOWS_COLLECTION)
    .where({ followerId, followingId })
    .limit(1)
    .get()
  return Array.isArray(data) && data.length > 0 ? data[0] : null
}

/**
 * 关注（幂等）。
 *
 * @param {object} db
 * @param {object} input
 * @param {string} input.followerId
 * @param {string} input.followingId
 * @param {number} [input.now]
 * @returns {Promise<{ following: true, deduped: boolean }>} deduped=true 表示此前已关注，未变更计数
 * @throws 关注自己
 */
async function followUser(db, { followerId, followingId, now = Date.now() }) {
  const me = assertUserId(followerId)
  const target = assertUserId(followingId)
  if (me === target)
    throw new Error('不能关注自己')

  // 预判去重：已关注直接返回，不动计数（重放 / 双击）
  const existing = await findFollow(db, { followerId: me, followingId: target })
  if (existing)
    return { following: true, deduped: true }

  try {
    await db.collection(USER_FOLLOWS_COLLECTION).add({
      followerId: me,
      followingId: target,
      createdAt: now,
    })
  }
  catch {
    // 并发重复关注撞联合唯一索引：视为已关注，不重复计数
    return { following: true, deduped: true }
  }

  // 仅首次建立关系时累加双方计数
  await bumpFollowCount(db, { userId: me, field: 'followingCount', delta: 1, now })
  await bumpFollowCount(db, { userId: target, field: 'followersCount', delta: 1, now })

  // 通知被关注者（写入失败不阻断关注主流程）
  try {
    await createFollowNotification(db, { userId: target, actorId: me, now })
  }
  catch {
    // 通知写入失败可接受，关注关系已成立
  }

  return { following: true, deduped: false }
}

/**
 * 取关（幂等）。对不存在的关系是 no-op。
 *
 * @param {object} db
 * @param {object} input
 * @param {string} input.followerId
 * @param {string} input.followingId
 * @param {number} [input.now]
 * @returns {Promise<{ following: false, deduped: boolean }>} deduped=true 表示此前未关注，未变更计数
 */
async function unfollowUser(db, { followerId, followingId, now = Date.now() }) {
  const me = assertUserId(followerId)
  const target = assertUserId(followingId)
  if (me === target)
    return { following: false, deduped: true }

  const existing = await findFollow(db, { followerId: me, followingId: target })
  if (!existing)
    return { following: false, deduped: true }

  const result = await db
    .collection(USER_FOLLOWS_COLLECTION)
    .where({ followerId: me, followingId: target })
    .remove()
  const removed = result?.deleted ?? result?.removed ?? 0
  if (removed <= 0) {
    // 并发已被删除：幂等返回，不重复减计数
    return { following: false, deduped: true }
  }

  await bumpFollowCount(db, { userId: me, field: 'followingCount', delta: -1, now })
  await bumpFollowCount(db, { userId: target, field: 'followersCount', delta: -1, now })

  return { following: false, deduped: false }
}

/**
 * 读取 viewer 与 target 的关系（公开；viewer 为空时均为 false）。
 *
 * @param {object} db
 * @param {object} input
 * @param {string} [input.viewerId]
 * @param {string} input.targetId
 * @returns {Promise<{ isFollowing: boolean, isFollowedBy: boolean }>} 关系标记
 */
async function getRelation(db, { viewerId, targetId }) {
  const target = assertUserId(targetId)
  if (!viewerId)
    return { isFollowing: false, isFollowedBy: false }
  const viewer = assertUserId(viewerId)
  if (viewer === target)
    return { isFollowing: false, isFollowedBy: false }

  const [out, back] = await Promise.all([
    findFollow(db, { followerId: viewer, followingId: target }),
    findFollow(db, { followerId: target, followingId: viewer }),
  ])
  return { isFollowing: !!out, isFollowedBy: !!back }
}

/** viewer 在 ids 中关注了哪些（返回被关注者 uid 集合，用于列表项标 isFollowing） */
async function fetchViewerFollowing(db, viewerId, ids) {
  const set = new Set()
  if (!viewerId || !ids.length)
    return set
  const { data } = await db
    .collection(USER_FOLLOWS_COLLECTION)
    .where({ followerId: viewerId, followingId: db.command.in(ids) })
    .limit(ids.length)
    .get()
  for (const r of (Array.isArray(data) ? data : []))
    set.add(r.followingId)
  return set
}

/**
 * 关注 / 粉丝列表分页（按关注时间倒序，join 资料，标记 viewer 是否关注）。
 *
 * @param {object} db
 * @param {object} input
 * @param {string} input.matchField user_follows 上筛 owner 的字段（followerId=关注列表 / followingId=粉丝列表）
 * @param {string} input.idField 取对端 uid 的字段
 * @param {string} input.ownerId
 * @param {string} [input.viewerId]
 * @param {number} input.skip
 * @param {number} input.limit
 * @param {string} [input.privacyField] 隐私字段名（hideFollowing/hideFollowers），owner 开启且非本人查看则拒绝
 * @param {number} [input.now]
 * @returns {Promise<{ items: Array, nextSkip: number|null, hidden?: boolean }>} 列表与下一页游标
 */
async function listRelations(db, { matchField, idField, ownerId, viewerId, skip, limit, privacyField, now = Date.now() }) {
  // 隐私：owner 隐藏该列表且查看者非本人 → 拒绝（计数仍公开，仅列表不可见）
  if (privacyField && viewerId !== ownerId) {
    const owner = await readProfileDoc(db, ownerId)
    if (owner && owner[privacyField])
      return { items: [], nextSkip: null, hidden: true }
  }
  const n = Math.min(Math.max(Number(limit) || 20, 1), 50)
  const s = Math.max(Number(skip) || 0, 0)
  const { data } = await db
    .collection(USER_FOLLOWS_COLLECTION)
    .where({ [matchField]: ownerId })
    .orderBy('createdAt', 'desc')
    .skip(s)
    .limit(n)
    .get()
  const rows = Array.isArray(data) ? data : []
  const ids = rows.map(r => r[idField])

  const [profiles, viewerFollowing] = await Promise.all([
    fetchProfilesByIds(db, ids, now),
    fetchViewerFollowing(db, viewerId, ids),
  ])

  const items = rows.map((r) => {
    const uid = r[idField]
    const p = profiles.get(uid)
    return {
      userId: uid,
      login: p?.login || null,
      nickname: resolvePublicNickname(p?.nickname, uid),
      avatar: p?.avatar || null,
      followersCount: p?.followersCount || 0,
      followingCount: p?.followingCount || 0,
      isMember: p?.isMember === true,
      isFollowing: viewerFollowing.has(uid),
      followedAt: r.createdAt,
    }
  })
  return { items, nextSkip: rows.length === n ? s + n : null }
}

/**
 * 某用户「关注的人」列表（owner 作为 follower）。
 *
 * @param {object} db
 * @param {object} input
 * @param {string} input.userId
 * @param {string} [input.viewerId]
 * @param {number} [input.skip]
 * @param {number} [input.limit]
 * @param {number} [input.now]
 * @returns {Promise<{ items: Array, nextSkip: number|null }>} 关注列表
 */
async function listFollowing(db, { userId, viewerId, skip = 0, limit = 20, now = Date.now() }) {
  return listRelations(db, {
    matchField: 'followerId',
    idField: 'followingId',
    ownerId: assertUserId(userId),
    viewerId,
    skip,
    limit,
    privacyField: 'hideFollowing',
    now,
  })
}

/**
 * 某用户「粉丝」列表（owner 作为 following）。
 *
 * @param {object} db
 * @param {object} input
 * @param {string} input.userId
 * @param {string} [input.viewerId]
 * @param {number} [input.skip]
 * @param {number} [input.limit]
 * @param {number} [input.now]
 * @returns {Promise<{ items: Array, nextSkip: number|null }>} 粉丝列表
 */
async function listFollowers(db, { userId, viewerId, skip = 0, limit = 20, now = Date.now() }) {
  return listRelations(db, {
    matchField: 'followingId',
    idField: 'followerId',
    ownerId: assertUserId(userId),
    viewerId,
    skip,
    limit,
    privacyField: 'hideFollowers',
    now,
  })
}

module.exports = {
  USER_FOLLOWS_COLLECTION,
  findFollow,
  followUser,
  unfollowUser,
  getRelation,
  listFollowing,
  listFollowers,
}
