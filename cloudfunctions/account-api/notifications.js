/**
 * 站内通知 user_notifications（account-api 本地模块，非同步 lib）。
 *
 * MVP 仅「关注」通知（type:'follow'）：A 关注 B → B 收到一条通知。
 * 通知是异步可拉取的，不走 WebSocket —— 前端进站拉未读数、按需翻列表即可。
 * actor 资料读时 join user_profiles（复用 fetchProfilesByIds，与 feed / 关注列表一致）。
 */

'use strict'

const { assertUserId, fetchProfilesByIds } = require('./profiles')

const USER_NOTIFICATIONS_COLLECTION = 'user_notifications'
/** 未读数上限（超出按此值显示 99+，避免全表扫描） */
const UNREAD_CAP = 99

/**
 * 写一条关注通知（被关注者 userId 收到，来自 actorId）。失败由调用方吞掉，不阻断关注主流程。
 *
 * @param {object} db
 * @param {object} input
 * @param {string} input.userId 接收者（被关注者）
 * @param {string} input.actorId 触发者（关注者）
 * @param {number} [input.now]
 */
async function createFollowNotification(db, { userId, actorId, now = Date.now() }) {
  if (!userId || !actorId || userId === actorId)
    return
  await db.collection(USER_NOTIFICATIONS_COLLECTION).add({
    userId,
    type: 'follow',
    actorId,
    read: false,
    createdAt: now,
  })
}

/**
 * 未读通知数（上限 UNREAD_CAP）。
 *
 * @param {object} db
 * @param {object} input
 * @param {string} input.userId
 * @returns {Promise<{ unread: number }>} 未读数（最多 UNREAD_CAP）
 */
async function getUnreadCount(db, { userId }) {
  const uid = assertUserId(userId)
  const { data } = await db
    .collection(USER_NOTIFICATIONS_COLLECTION)
    .where({ userId: uid, read: false })
    .limit(UNREAD_CAP + 1)
    .get()
  return { unread: Math.min(Array.isArray(data) ? data.length : 0, UNREAD_CAP) }
}

/**
 * 通知列表分页（按时间倒序，join actor 资料）。
 *
 * @param {object} db
 * @param {object} input
 * @param {string} input.userId
 * @param {number} [input.skip]
 * @param {number} [input.limit]
 * @returns {Promise<{ items: Array, nextSkip: number|null }>} 通知列表与下一页游标
 */
async function listNotifications(db, { userId, skip = 0, limit = 20 }) {
  const uid = assertUserId(userId)
  const n = Math.min(Math.max(Number(limit) || 20, 1), 50)
  const s = Math.max(Number(skip) || 0, 0)
  const { data } = await db
    .collection(USER_NOTIFICATIONS_COLLECTION)
    .where({ userId: uid })
    .orderBy('createdAt', 'desc')
    .skip(s)
    .limit(n)
    .get()
  const rows = Array.isArray(data) ? data : []
  const profiles = await fetchProfilesByIds(db, [...new Set(rows.map(r => r.actorId))])

  const items = rows.map((r) => {
    const p = profiles.get(r.actorId)
    return {
      id: r._id,
      type: r.type,
      read: !!r.read,
      createdAt: r.createdAt,
      actor: {
        userId: r.actorId,
        login: p?.login || null,
        nickname: p?.nickname || '',
        avatar: p?.avatar || null,
      },
    }
  })
  return { items, nextSkip: rows.length === n ? s + n : null }
}

/**
 * 标记已读：传 ids 标记指定几条，否则标记全部未读。均限定本人（防越权）。
 *
 * @param {object} db
 * @param {object} input
 * @param {string} input.userId
 * @param {string[]} [input.ids]
 * @param {number} [input.now]
 * @returns {Promise<{ ok: true }>} 操作结果
 */
async function markRead(db, { userId, ids, now = Date.now() }) {
  const uid = assertUserId(userId)
  if (Array.isArray(ids) && ids.length) {
    for (const id of ids) {
      // where(_id + userId) 限本人，防止标记他人通知
      await db
        .collection(USER_NOTIFICATIONS_COLLECTION)
        .where({ _id: id, userId: uid })
        .update({ read: true, readAt: now })
    }
    return { ok: true }
  }
  await db
    .collection(USER_NOTIFICATIONS_COLLECTION)
    .where({ userId: uid, read: false })
    .update({ read: true, readAt: now })
  return { ok: true }
}

module.exports = {
  USER_NOTIFICATIONS_COLLECTION,
  createFollowNotification,
  getUnreadCount,
  listNotifications,
  markRead,
}
