/**
 * 关注动态 Feed（account-api 本地模块，非同步 lib）。
 *
 * 拉模式（fan-out on read）：读时查「我关注的人」最近发布 / 更新的公开应用。
 * MVP 动态源 = apps（复用现有集合，无需新建 feed 表）；未来可把投币 / 签到等事件
 * 沉淀到统一 activity 表再聚合。平台规模小，关注扇出有上限保护。
 */

'use strict'

const { USER_FOLLOWS_COLLECTION } = require('./follows')
const { assertUserId, fetchProfilesByIds } = require('./profiles')

const APPS_COLLECTION = 'apps'
/** 关注扇出上限（CloudBase in 查询数量保护；超出的关注对象本期不进 feed） */
const MAX_FOLLOWING_FANOUT = 200

/**
 * 关注动态 Feed：我关注的人最近发布 / 更新的公开应用（按更新时间倒序，分页）。
 *
 * @param {object} db
 * @param {object} input
 * @param {string} input.userId 当前登录者
 * @param {number} [input.skip]
 * @param {number} [input.limit]
 * @param {number} [input.now]
 * @returns {Promise<{ items: Array, nextSkip: number|null }>} feed 列表与下一页游标
 */
async function getFollowingFeed(db, { userId, skip = 0, limit = 20, now = Date.now() }) {
  const uid = assertUserId(userId)
  const n = Math.min(Math.max(Number(limit) || 20, 1), 50)
  const s = Math.max(Number(skip) || 0, 0)

  // 1. 我关注谁
  const { data: follows } = await db
    .collection(USER_FOLLOWS_COLLECTION)
    .where({ followerId: uid })
    .limit(MAX_FOLLOWING_FANOUT)
    .get()
  const ownerIds = (Array.isArray(follows) ? follows : []).map(f => f.followingId)
  if (!ownerIds.length)
    return { items: [], nextSkip: null }

  // 2. 这些人发布的公开应用（更新时间倒序，分页）
  const { data: apps } = await db
    .collection(APPS_COLLECTION)
    .where({ ownerId: db.command.in(ownerIds), isPublic: true })
    .orderBy('updatedAt', 'desc')
    .skip(s)
    .limit(n)
    .get()
  const rows = Array.isArray(apps) ? apps : []

  // 3. join 作者资料（头像 / 昵称；ownerLogin 兜底）
  const profiles = await fetchProfilesByIds(db, [...new Set(rows.map(a => a.ownerId))], now)

  const items = rows.map((a) => {
    const p = profiles.get(a.ownerId)
    return {
      type: 'app',
      appId: a._id,
      slug: a.slug,
      name: a.name,
      icon: a.icon || '',
      description: a.description || '',
      owner: {
        userId: a.ownerId,
        login: p?.login || a.ownerLogin || null,
        nickname: p?.nickname || '',
        avatar: p?.avatar || null,
        isMember: p?.isMember === true,
      },
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    }
  })
  return { items, nextSkip: rows.length === n ? s + n : null }
}

module.exports = {
  APPS_COLLECTION,
  MAX_FOLLOWING_FANOUT,
  getFollowingFeed,
}
