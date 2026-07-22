/**
 * 账号注销状态机（account-api 本地模块，非同步 lib）。
 *
 * 用户申请后进入 30 天冷静期；期间账号业务能力冻结，可在截止前明确撤回。到期后由独立定时任务：
 *   1. 阻止认证身份继续登录；
 *   2. 调用 finalizeAccountDeletion 清理业务资料；
 *   3. 删除 CloudBase Auth 用户，释放 GitHub / 手机 / 邮箱等认证绑定。
 *
 * 订单、钱包和云币流水等财务记录按合规要求保留，不在本模块删除。
 */

'use strict'

const {
  cancelDeletionNotifications,
  enqueueDeletionNotifications,
} = require('./account-deletion-notifications')
const { USER_FOLLOWS_COLLECTION } = require('./follows')
const { assertUserId, bumpFollowCount, readProfileDoc, USER_PROFILES_COLLECTION } = require('./profiles')

const USER_NOTIFICATIONS_COLLECTION = 'user_notifications'
const GITHUB_INSTALLATIONS_COLLECTION = 'github_installations'
const USER_SIGNIN_STATS_COLLECTION = 'user_signin_stats'
const IDENTITY_ARTIFACT_QUERIES = [
  ['desktop_device_codes', 'uid'],
  ['desktop_devices', 'uid'],
  ['sso_login_codes', 'uid'],
  ['ai_usage_daily', 'uid'],
]
const ACCOUNT_DELETION_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000
/** 分页捞取关系的页大小（避免大 V 用户关系被默认 limit 截断） */
const PAGE = 100

/** 分页捞完某条件下的全部 user_follows 文档 */
async function fetchAllFollows(db, where) {
  const out = []
  let skip = 0
  for (;;) {
    const { data } = await db
      .collection(USER_FOLLOWS_COLLECTION)
      .where(where)
      .skip(skip)
      .limit(PAGE)
      .get()
    const rows = Array.isArray(data) ? data : []
    out.push(...rows)
    if (rows.length < PAGE)
      break
    skip += PAGE
  }
  return out
}

/** 清理核心账号体系中的可撤销会话、授权码与派生用量，不触碰订单/钱包/流水。 */
async function removeIdentityArtifacts(db, uid) {
  let removed = 0
  const githubResult = await db.collection(GITHUB_INSTALLATIONS_COLLECTION).doc(uid).remove()
  removed += githubResult?.deleted || 0
  const signinResult = await db.collection(USER_SIGNIN_STATS_COLLECTION).where({ userId: uid }).remove()
  removed += signinResult?.deleted || 0
  for (const [collection, field] of IDENTITY_ARTIFACT_QUERIES) {
    const result = await db.collection(collection).where({ [field]: uid }).remove()
    removed += result?.deleted || 0
  }
  return removed
}

function emptyStatus() {
  return {
    status: 'none',
    requestedAt: null,
    scheduledAt: null,
    remainingMs: 0,
    canCancel: false,
  }
}

/** 把 profile 上的内部字段投影成前端可用的注销状态。 */
function projectDeletionStatus(profile, now = Date.now()) {
  if (!profile)
    return emptyStatus()

  if (profile.deletionStatus === 'completed' || profile.authDeletedAt) {
    return {
      status: 'completed',
      requestedAt: profile.deletionRequestedAt || null,
      scheduledAt: null,
      remainingMs: 0,
      canCancel: false,
    }
  }

  if (profile.deletionStatus === 'finalizing') {
    return {
      status: 'finalizing',
      requestedAt: profile.deletionRequestedAt || null,
      scheduledAt: profile.deletionScheduledAt || null,
      remainingMs: 0,
      canCancel: false,
    }
  }

  if (profile.deletionStatus === 'pending' && Number.isFinite(profile.deletionScheduledAt)) {
    const remainingMs = Math.max(0, profile.deletionScheduledAt - now)
    return {
      status: 'pending',
      requestedAt: profile.deletionRequestedAt || null,
      scheduledAt: profile.deletionScheduledAt,
      remainingMs,
      canCancel: remainingMs > 0,
    }
  }

  // 兼容旧版“只清业务资料、不删 Auth”的半注销数据，交由人工核对，绝不自动硬删。
  if (profile.deletedAt) {
    return {
      status: 'attention_required',
      requestedAt: null,
      scheduledAt: null,
      remainingMs: 0,
      canCancel: false,
    }
  }

  return emptyStatus()
}

async function ensureProfile(db, uid, now) {
  const existing = await readProfileDoc(db, uid)
  if (existing)
    return existing

  await db.collection(USER_PROFILES_COLLECTION).add({
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
  })
  return readProfileDoc(db, uid)
}

/** 申请注销；重复申请幂等，保留第一次到期时间。 */
async function requestAccountDeletion(db, { userId, now = Date.now() }) {
  const uid = assertUserId(userId)
  const existing = await ensureProfile(db, uid, now)

  if (existing.deletedAt)
    throw new Error('账号已进入注销清理流程，请联系客服核对状态')

  if (existing.deletionStatus === 'pending' && Number.isFinite(existing.deletionScheduledAt))
    return projectDeletionStatus(existing, now)

  const scheduledAt = now + ACCOUNT_DELETION_COOLDOWN_MS
  await db.collection(USER_PROFILES_COLLECTION).doc(uid).update({
    deletionStatus: 'pending',
    deletionRequestedAt: now,
    deletionScheduledAt: scheduledAt,
    deletionDataCompletedAt: null,
    deletionLastErrorAt: null,
    updatedAt: now,
  })

  try {
    await enqueueDeletionNotifications(db, { userId: uid, requestedAt: now, scheduledAt })
  }
  catch (error) {
    // 邮件是辅助通知，第三方或队列故障不得阻断用户的数据权利。
    console.error('[account-deletion] notification enqueue failed', error?.message)
  }

  return projectDeletionStatus(await readProfileDoc(db, uid), now)
}

/** 查询本人注销状态。 */
async function getAccountDeletionStatus(db, { userId, now = Date.now() }) {
  const uid = assertUserId(userId)
  return projectDeletionStatus(await readProfileDoc(db, uid), now)
}

/** 冷静期内撤回注销。 */
async function cancelAccountDeletion(db, { userId, now = Date.now() }) {
  const uid = assertUserId(userId)
  const existing = await readProfileDoc(db, uid)
  if (!existing || existing.deletionStatus !== 'pending')
    return projectDeletionStatus(existing, now)
  if (!Number.isFinite(existing.deletionScheduledAt) || now >= existing.deletionScheduledAt)
    throw new Error('30 天冷静期已结束，注销清理已经开始')

  await db.collection(USER_PROFILES_COLLECTION).doc(uid).update({
    deletionStatus: null,
    deletionRequestedAt: null,
    deletionScheduledAt: null,
    deletionDataCompletedAt: null,
    deletionLastErrorAt: null,
    updatedAt: now,
  })
  try {
    await cancelDeletionNotifications(db, {
      userId: uid,
      requestedAt: existing.deletionRequestedAt,
      now,
    })
  }
  catch (error) {
    console.error('[account-deletion] notification cancellation failed', error?.message)
  }
  return emptyStatus()
}

/**
 * 到期后清理业务资料。只供持有 ACCOUNT_API_INTERNAL_TOKEN 的定时任务调用。
 * deletionScheduledAt 会保留到 Auth 用户确实删除后，确保认证删除失败时下一轮仍可重试。
 */
async function finalizeAccountDeletion(db, { userId, now = Date.now() }) {
  const uid = assertUserId(userId)
  const existing = await readProfileDoc(db, uid)
  const isDeletable = existing
    && (existing.deletionStatus === 'pending' || existing.deletionStatus === 'finalizing')
    && Number.isFinite(existing.deletionScheduledAt)

  if (!isDeletable)
    return { finalized: false, reason: 'not_pending' }
  if (now < existing.deletionScheduledAt)
    return { finalized: false, reason: 'not_due' }
  if (existing.deletionDataCompletedAt) {
    return {
      finalized: true,
      alreadyFinalized: true,
      deletedAt: existing.deletedAt,
      removedFollowing: 0,
      removedFollowers: 0,
    }
  }

  const deletedAt = existing.deletedAt || now
  // 先锁定为 finalizing 并清除公开 PII，后续任何失败都会由定时任务重试。
  await db.collection(USER_PROFILES_COLLECTION).doc(uid).update({
    login: null,
    nickname: '已注销用户',
    avatar: null,
    description: '',
    followersCount: 0,
    followingCount: 0,
    hideFollowers: false,
    hideFollowing: false,
    deletionStatus: 'finalizing',
    deletedAt,
    updatedAt: now,
  })

  let removedFollowing = 0
  const iFollow = await fetchAllFollows(db, { followerId: uid })
  for (const follow of iFollow) {
    const result = await db.collection(USER_FOLLOWS_COLLECTION).where({ followerId: uid, followingId: follow.followingId }).remove()
    if ((result?.deleted || 0) > 0) {
      await bumpFollowCount(db, { userId: follow.followingId, field: 'followersCount', delta: -1, now })
      removedFollowing += 1
    }
  }

  let removedFollowers = 0
  const myFollowers = await fetchAllFollows(db, { followingId: uid })
  for (const follow of myFollowers) {
    const result = await db.collection(USER_FOLLOWS_COLLECTION).where({ followerId: follow.followerId, followingId: uid }).remove()
    if ((result?.deleted || 0) > 0) {
      await bumpFollowCount(db, { userId: follow.followerId, field: 'followingCount', delta: -1, now })
      removedFollowers += 1
    }
  }

  await db.collection(USER_NOTIFICATIONS_COLLECTION).where({ userId: uid }).remove()
  const removedIdentityArtifacts = await removeIdentityArtifacts(db, uid)
  await db.collection(USER_PROFILES_COLLECTION).doc(uid).update({
    deletionDataCompletedAt: now,
    updatedAt: now,
  })

  return {
    finalized: true,
    deletedAt,
    removedFollowing,
    removedFollowers,
    removedIdentityArtifacts,
  }
}

module.exports = {
  ACCOUNT_DELETION_COOLDOWN_MS,
  cancelAccountDeletion,
  finalizeAccountDeletion,
  getAccountDeletionStatus,
  projectDeletionStatus,
  removeIdentityArtifacts,
  requestAccountDeletion,
}
