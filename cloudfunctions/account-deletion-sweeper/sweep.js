/** 账号到期注销编排。依赖注入便于验证 Auth 身份删除是强制步骤。 */

'use strict'

const USER_PROFILES_COLLECTION = 'user_profiles'
const SWEEP_LIMIT = 20
const RETRY_BASE_MS = 5 * 60 * 1000
const RETRY_MAX_MS = 6 * 60 * 60 * 1000
const USER_DELAY_NOTICE_MS = 24 * 60 * 60 * 1000

function responseData(response) {
  return response?.Data || response?.data || {}
}

/** Manager SDK 的用户操作适配成幂等接口；Auth 用户已不存在也视为目标已达成。 */
function createAuthAdmin(manager) {
  async function userExists(userId) {
    const result = await manager.user.describeUserList({ uidList: [userId], pageNo: 1, pageSize: 1 })
    const data = responseData(result)
    return Number(data.Total) > 0 || (Array.isArray(data.UserList) && data.UserList.length > 0)
  }

  return {
    async blockUser(userId) {
      if (!await userExists(userId))
        return { present: false }
      await manager.user.modifyUser({ uid: userId, userStatus: 'BLOCKED' })
      return { present: true }
    },
    async deleteUser(userId) {
      if (!await userExists(userId))
        return { deleted: false, alreadyAbsent: true }
      const result = await manager.user.deleteUsers({ uids: [userId] })
      const data = responseData(result)
      if (Number(data.SuccessCount) !== 1 || Number(data.FailedCount) > 0)
        throw new Error('CloudBase Auth user deletion failed')
      return { deleted: true }
    },
  }
}

function createStore(db) {
  return {
    async listDue(now) {
      // 只依赖现有 _id 索引分页，避免部署前必须先在线创建 deletionScheduledAt 索引。
      const due = []
      let cursor = ''
      for (;;) {
        let query = db.collection(USER_PROFILES_COLLECTION).orderBy('_id', 'asc')
        if (cursor)
          query = query.where({ _id: db.command.gt(cursor) })
        const { data } = await query.limit(100).get()
        const rows = Array.isArray(data) ? data : []
        for (const row of rows) {
          if ((row.deletionStatus === 'pending' || row.deletionStatus === 'finalizing')
            && Number.isFinite(row.deletionScheduledAt)
            && row.deletionScheduledAt <= now
            && (!Number.isFinite(row.deletionNextRetryAt) || row.deletionNextRetryAt <= now)) {
            due.push(row)
            if (due.length >= SWEEP_LIMIT)
              return due
          }
        }
        if (rows.length < 100)
          return due
        cursor = rows[rows.length - 1]._id
      }
    },
    async markCompleted(userId, now) {
      await db.collection(USER_PROFILES_COLLECTION).doc(userId).update({
        deletionStatus: 'completed',
        deletionScheduledAt: null,
        deletionCompletedAt: now,
        authDeletedAt: now,
        deletionLastErrorAt: null,
        deletionFirstErrorAt: null,
        deletionFailureCount: 0,
        deletionNextRetryAt: null,
        updatedAt: now,
      })
    },
    async markFailed(userId, now, error) {
      const result = await db.collection(USER_PROFILES_COLLECTION).doc(userId).get()
      const row = Array.isArray(result?.data) ? result.data[0] : result?.data
      const failureCount = Math.max(0, Number(row?.deletionFailureCount) || 0) + 1
      const firstErrorAt = Number.isFinite(row?.deletionFirstErrorAt)
        ? row.deletionFirstErrorAt
        : now
      const shouldAlertOps = failureCount >= 3 && !Number.isFinite(row?.deletionOpsAlertedAt)
      const shouldNotifyUser = now - firstErrorAt >= USER_DELAY_NOTICE_MS
        && !Number.isFinite(row?.deletionDelayedNoticeAt)
      const retryDelay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(failureCount - 1, 10))
      const patch = {
        deletionLastErrorAt: now,
        deletionLastErrorCode: typeof error?.code === 'string' ? error.code.slice(0, 80) : (error?.name || 'Error'),
        deletionFirstErrorAt: firstErrorAt,
        deletionFailureCount: failureCount,
        deletionNextRetryAt: now + retryDelay,
        updatedAt: now,
      }
      if (shouldAlertOps)
        patch.deletionOpsAlertedAt = now
      if (shouldNotifyUser)
        patch.deletionDelayedNoticeAt = now
      await db.collection(USER_PROFILES_COLLECTION).doc(userId).update({
        ...patch,
      })
      return { failureCount, firstErrorAt, shouldAlertOps, shouldNotifyUser, nextRetryAt: now + retryDelay }
    },
  }
}

async function safeNotify(fn, ...args) {
  if (typeof fn !== 'function')
    return
  try {
    await fn(...args)
  }
  catch (error) {
    console.error('[account-deletion-sweeper] lifecycle notification failed', error?.message)
  }
}

async function sweepDueAccountDeletions({ store, accountApi, authAdmin, notifier = {}, now = Date.now() }) {
  if (!store || !accountApi || !authAdmin)
    throw new TypeError('account deletion sweep dependencies are required')

  const due = await store.listDue(now)
  let completed = 0
  let failed = 0

  for (const row of due) {
    const userId = row?._id
    if (typeof userId !== 'string' || !userId) {
      failed++
      continue
    }

    try {
      // 先阻断新会话，再清理业务资料，最后硬删 Auth 释放第三方/手机/邮箱绑定。
      await authAdmin.blockUser(userId)
      const finalized = await accountApi.finalize(userId, now)
      if (!finalized?.finalized)
        throw new Error('business deletion was not finalized')
      await authAdmin.deleteUser(userId)
      await store.markCompleted(userId, now)
      await safeNotify(notifier.notifyCompleted, userId, now)
      completed++
    }
    catch (error) {
      const failure = await store.markFailed(userId, now, error)
      if (failure?.shouldAlertOps)
        await safeNotify(notifier.alertOps, userId, failure)
      if (failure?.shouldNotifyUser)
        await safeNotify(notifier.notifyDelayed, userId, failure)
      failed++
    }
  }

  return { ok: failed === 0, scanned: due.length, completed, failed }
}

module.exports = {
  SWEEP_LIMIT,
  RETRY_BASE_MS,
  RETRY_MAX_MS,
  createAuthAdmin,
  createStore,
  sweepDueAccountDeletions,
}
