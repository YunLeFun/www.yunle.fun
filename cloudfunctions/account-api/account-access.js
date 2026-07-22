/**
 * 账户访问状态真源。
 *
 * CloudBase Auth 只负责证明“是谁”；注销冷静期和管理员封禁属于业务授权，
 * 必须由所有受保护服务在服务端再次校验。这里仅返回可向账号本人公开的字段。
 */

'use strict'

const { ACCOUNT_RESTRICTIONS_COLLECTION } = require('./account-restrictions')
const { assertUserId, readProfileDoc } = require('./profiles')

const DELETION_ALLOWED_ACTIONS = new Set([
  'getAccountAccessStatus',
  'getAccountDeletionStatus',
  'cancelAccountDeletion',
])

class AccountAccessError extends Error {
  constructor(message, { code, state, access } = {}) {
    super(message)
    this.name = 'AccountAccessError'
    this.code = code || 'account_restricted'
    this.state = state || 'restricted'
    this.access = access
    this.httpStatus = 403
  }
}

function activeAccess() {
  return { state: 'active', restricted: false }
}

async function readRestriction(db, userId) {
  const { data } = await db.collection(ACCOUNT_RESTRICTIONS_COLLECTION).doc(userId).get()
  if (Array.isArray(data))
    return data[0] || null
  return data || null
}

async function getAdminBanAccess(db, userId, now) {
  const restriction = await readRestriction(db, userId)
  if (!restriction || restriction.type !== 'admin_ban' || restriction.status !== 'active')
    return null

  // 到期以服务端时间立即放行；持久化状态和不可变审计统一由维护任务完成，
  // 避免普通用户请求产生无审计的管理状态写入。
  if (Number.isFinite(restriction.expiresAt) && restriction.expiresAt <= now)
    return null

  return {
    state: 'admin_banned',
    restricted: true,
    recoverable: false,
    reasonCode: restriction.reasonCode || 'policy_violation',
    publicReason: restriction.publicReason || '该账号因违反平台规则已被限制使用',
    caseId: restriction.caseId || null,
    appealUrl: restriction.appealUrl || '/docs/contact?topic=appeal',
    startedAt: restriction.createdAt || null,
    expiresAt: Number.isFinite(restriction.expiresAt) ? restriction.expiresAt : null,
    permanent: !Number.isFinite(restriction.expiresAt),
  }
}

function getDeletionAccess(profile, now) {
  if (!profile)
    return null

  const scheduledAt = Number.isFinite(profile.deletionScheduledAt)
    ? profile.deletionScheduledAt
    : null

  if (profile.deletionStatus === 'pending' && scheduledAt !== null) {
    const recoverable = now < scheduledAt
    return {
      state: recoverable ? 'deletion_pending' : 'deletion_finalizing',
      restricted: true,
      recoverable,
      requestedAt: profile.deletionRequestedAt || null,
      scheduledAt,
    }
  }

  if (profile.deletionStatus === 'finalizing'
    || profile.deletionStatus === 'completed'
    || profile.authDeletedAt
    || profile.deletedAt) {
    return {
      state: 'deletion_finalizing',
      restricted: true,
      recoverable: false,
      requestedAt: profile.deletionRequestedAt || null,
      scheduledAt,
    }
  }

  return null
}

async function getAccountAccess(db, { userId, now = Date.now() }) {
  const uid = assertUserId(userId)
  const adminBan = await getAdminBanAccess(db, uid, now)
  if (adminBan)
    return adminBan

  const deletion = getDeletionAccess(await readProfileDoc(db, uid), now)
  return deletion || activeAccess()
}

function accessError(access) {
  if (access.state === 'admin_banned') {
    return new AccountAccessError('账号已被封禁', {
      code: 'account_banned',
      state: access.state,
      access,
    })
  }
  if (access.state === 'deletion_pending') {
    return new AccountAccessError('账号正在注销冷静期，请先恢复账号', {
      code: 'account_deletion_pending',
      state: access.state,
      access,
    })
  }
  return new AccountAccessError('账号正在完成注销，已无法恢复', {
    code: 'account_deletion_finalizing',
    state: access.state,
    access,
  })
}

async function assertAccountActionAllowed(db, { userId, action, now = Date.now() }) {
  const access = await getAccountAccess(db, { userId, now })
  if (!access.restricted)
    return

  if (access.state === 'deletion_pending'
    && DELETION_ALLOWED_ACTIONS.has(action)
    && (action !== 'cancelAccountDeletion' || access.recoverable)) {
    return
  }
  if (action === 'getAccountAccessStatus')
    return
  throw accessError(access)
}

module.exports = {
  ACCOUNT_RESTRICTIONS_COLLECTION,
  AccountAccessError,
  assertAccountActionAllowed,
  getAccountAccess,
}
