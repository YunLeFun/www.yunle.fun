/**
 * 站内通知 user_notifications（account-api 本地模块，非同步 lib）。
 *
 * MVP 仅「关注」通知（type:'follow'）：A 关注 B → B 收到一条通知。
 * 通知是异步可拉取的，不走 WebSocket —— 前端进站拉未读数、按需翻列表即可。
 * actor 资料读时 join user_profiles（复用 fetchProfilesByIds，与 feed / 关注列表一致）。
 */

'use strict'

const crypto = require('node:crypto')

const {
  assertUserId,
  fetchProfilesByIds,
  readProfileDoc,
  resolvePublicNickname,
} = require('./profiles')

const USER_NOTIFICATIONS_COLLECTION = 'user_notifications'
/** 未读数上限（超出按此值显示 99+，避免全表扫描） */
const UNREAD_CAP = 99

function rewardNotificationId(grantId) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(['reward_notification', grantId]))
    .digest('hex')
    .slice(0, 24)
}

/** 写入一条幂等的奖励到账通知；同一 grantId 重放不会产生重复通知。 */
async function createRewardNotification(db, {
  userId,
  grantId,
  rewardName,
  coinAmount,
  membershipDays,
  now = Date.now(),
}) {
  const uid = assertUserId(userId)
  await db.collection(USER_NOTIFICATIONS_COLLECTION).doc(rewardNotificationId(grantId)).set({
    userId: uid,
    type: 'reward',
    rewardName,
    coinAmount,
    membershipDays,
    grantId,
    read: false,
    createdAt: now,
  })
}

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
  // 接收者关闭了「被关注」通知则跳过（缺省视为开启）
  const target = await readProfileDoc(db, userId)
  if (target && target.notifyOnFollow === false)
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
 * @param {number} [input.now]
 * @returns {Promise<{ items: Array, nextSkip: number|null }>} 通知列表与下一页游标
 */
async function listNotifications(db, { userId, skip = 0, limit = 20, now = Date.now() }) {
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
  const profiles = await fetchProfilesByIds(db, [...new Set(rows.filter(r => r.type === 'follow').map(r => r.actorId))], now)

  const items = rows.map((r) => {
    if (r.type === 'reward') {
      return {
        id: r._id,
        type: 'reward',
        read: !!r.read,
        createdAt: r.createdAt,
        reward: {
          grantId: r.grantId,
          rewardName: r.rewardName,
          coinAmount: r.coinAmount || 0,
          membershipDays: r.membershipDays || 0,
        },
      }
    }
    const p = profiles.get(r.actorId)
    return {
      id: r._id,
      type: r.type,
      read: !!r.read,
      createdAt: r.createdAt,
      actor: {
        userId: r.actorId,
        login: p?.login || null,
        nickname: resolvePublicNickname(p?.nickname, r.actorId),
        avatar: p?.avatar || null,
        isMember: p?.isMember === true,
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
  createRewardNotification,
  getUnreadCount,
  listNotifications,
  markRead,
}
