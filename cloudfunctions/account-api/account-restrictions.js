/**
 * 管理员账号限制真源。
 *
 * 封禁与用户主动注销是两条独立状态机：管理员封禁不修改 CloudBase Auth，
 * 让账号本人仍能登录并看到原因、期限、案件编号和申诉入口；所有业务服务
 * 通过 account-access.js 在服务端拒绝受限操作。
 */

'use strict'

const crypto = require('node:crypto')

const { assertUserId, readProfileDoc } = require('./profiles')
const { classifyAccountIdentity } = require('./synthetic')

const ACCOUNT_RESTRICTIONS_COLLECTION = 'account_restrictions'
const ACCOUNT_RESTRICTION_AUDIT_COLLECTION = 'account_restriction_audit'
const ADMIN_BAN_TYPE = 'admin_ban'
const ALLOWED_REASON_CODES = new Set([
  'abuse',
  'chargeback',
  'fraud',
  'policy_violation',
  'security',
  'terms',
  'other',
])

function requiredText(value, name, max) {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${name}必填`)
  return value.trim().slice(0, max)
}

function optionalText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function assertRequestId(value) {
  const requestId = requiredText(value, 'requestId', 128)
  if (!/^[\w:.-]{4,128}$/.test(requestId))
    throw new Error('requestId 格式不正确')
  return requestId
}

function assertReasonCode(value) {
  const reasonCode = requiredText(value, 'reasonCode', 40)
  if (!ALLOWED_REASON_CODES.has(reasonCode))
    throw new Error('reasonCode 不受支持')
  return reasonCode
}

function assertAppealUrl(value) {
  const appealUrl = optionalText(value, 512) || '/docs/contact?topic=appeal'
  if (appealUrl.startsWith('/')) {
    if (appealUrl.startsWith('//'))
      throw new Error('申诉链接不安全')
    return appealUrl
  }
  try {
    const parsed = new URL(appealUrl)
    if (parsed.protocol !== 'https:' || (parsed.hostname !== 'yunle.fun' && !parsed.hostname.endsWith('.yunle.fun')))
      throw new Error('invalid')
    return parsed.toString()
  }
  catch {
    throw new Error('申诉链接不安全')
  }
}

function assertExpiresAt(value, now) {
  if (value === null || value === undefined || value === '')
    return null
  const expiresAt = Number(value)
  if (!Number.isFinite(expiresAt) || expiresAt <= now)
    throw new Error('封禁期限必须晚于当前时间')
  return expiresAt
}

function chinaDateStamp(now) {
  return new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10).replaceAll('-', '')
}

function stableHash(...parts) {
  return crypto.createHash('sha256').update(parts.join('\u0000')).digest('hex')
}

function buildCaseId(userId, requestId, now) {
  return `BAN-${chinaDateStamp(now)}-${stableHash(userId, requestId).slice(0, 8).toUpperCase()}`
}

function auditId(action, userId, requestId) {
  return `restriction_${stableHash(action, userId, requestId)}`
}

function publicRestriction(doc, extra = {}) {
  if (!doc)
    return null
  return {
    userId: doc._id,
    type: doc.type,
    status: doc.status,
    reasonCode: doc.reasonCode,
    publicReason: doc.publicReason,
    caseId: doc.caseId,
    appealUrl: doc.appealUrl,
    createdAt: doc.createdAt,
    expiresAt: Number.isFinite(doc.expiresAt) ? doc.expiresAt : null,
    permanent: !Number.isFinite(doc.expiresAt),
    revokedAt: doc.revokedAt || null,
    expiredAt: doc.expiredAt || null,
    ...extra,
  }
}

function assertDeletionNotInProgress(profile) {
  if (!profile)
    return
  if (['pending', 'finalizing', 'completed'].includes(profile.deletionStatus)
    || profile.deletedAt
    || profile.authDeletedAt) {
    throw new Error('账号正在注销或已注销，不能叠加封禁')
  }
}

async function banAccount(db, input = {}) {
  const now = Number.isFinite(input.now) ? input.now : Date.now()
  const userId = assertUserId(input.userId)
  const reasonCode = assertReasonCode(input.reasonCode)
  const publicReason = requiredText(input.publicReason, '公开原因', 300)
  const internalNote = optionalText(input.internalNote, 2000)
  const expiresAt = assertExpiresAt(input.expiresAt, now)
  const appealUrl = assertAppealUrl(input.appealUrl)
  const operator = requiredText(input.operator, 'operator', 128)
  const requestId = assertRequestId(input.requestId)

  const [profile, classification] = await Promise.all([
    readProfileDoc(db, userId),
    classifyAccountIdentity(db, userId),
  ])
  assertDeletionNotInProgress(profile)
  if (classification.synthetic)
    throw new Error('受管测试身份不能使用正式账号封禁流程')

  return db.runTransaction(async (transaction) => {
    const ref = transaction.collection(ACCOUNT_RESTRICTIONS_COLLECTION).doc(userId)
    const { data } = await ref.get()
    const existing = Array.isArray(data) ? data[0] : data
    if (existing?.lastRequestId === requestId && existing?.lastAction === 'ban')
      return publicRestriction(existing, { deduped: true })
    if (existing?.type === ADMIN_BAN_TYPE && existing?.status === 'active')
      throw new Error('账号已处于封禁状态，请先解封或使用原 requestId 重试')

    const caseId = buildCaseId(userId, requestId, now)
    const restriction = {
      _id: userId,
      type: ADMIN_BAN_TYPE,
      status: 'active',
      reasonCode,
      publicReason,
      internalNote,
      appealUrl,
      caseId,
      expiresAt,
      createdAt: now,
      createdBy: operator,
      updatedAt: now,
      lastAction: 'ban',
      lastRequestId: requestId,
    }
    await ref.set(restriction)
    await transaction.collection(ACCOUNT_RESTRICTION_AUDIT_COLLECTION).add({
      _id: auditId('ban', userId, requestId),
      action: 'ban',
      userId,
      caseId,
      reasonCode,
      publicReason,
      internalNote,
      expiresAt,
      appealUrl,
      operator,
      requestId,
      createdAt: now,
    })
    return publicRestriction(restriction, { deduped: false })
  })
}

async function unbanAccount(db, input = {}) {
  const now = Number.isFinite(input.now) ? input.now : Date.now()
  const userId = assertUserId(input.userId)
  const reason = requiredText(input.reason, '解封原因', 500)
  const operator = requiredText(input.operator, 'operator', 128)
  const requestId = assertRequestId(input.requestId)

  return db.runTransaction(async (transaction) => {
    const ref = transaction.collection(ACCOUNT_RESTRICTIONS_COLLECTION).doc(userId)
    const { data } = await ref.get()
    const existing = Array.isArray(data) ? data[0] : data
    if (!existing || existing.type !== ADMIN_BAN_TYPE)
      throw new Error('未找到管理员封禁记录')
    if (existing.lastRequestId === requestId && existing.lastAction === 'unban')
      return publicRestriction(existing, { deduped: true })
    if (existing.status !== 'active')
      throw new Error('账号当前未处于封禁状态')

    const updates = {
      status: 'revoked',
      revokedAt: now,
      revokedBy: operator,
      revokeReason: reason,
      updatedAt: now,
      lastAction: 'unban',
      lastRequestId: requestId,
    }
    await ref.update(updates)
    await transaction.collection(ACCOUNT_RESTRICTION_AUDIT_COLLECTION).add({
      _id: auditId('unban', userId, requestId),
      action: 'unban',
      userId,
      caseId: existing.caseId,
      reason,
      operator,
      requestId,
      createdAt: now,
    })
    return publicRestriction({ ...existing, ...updates }, { deduped: false })
  })
}

async function expireOne(db, restriction, now) {
  return db.runTransaction(async (transaction) => {
    const ref = transaction.collection(ACCOUNT_RESTRICTIONS_COLLECTION).doc(restriction._id)
    const { data } = await ref.get()
    const current = Array.isArray(data) ? data[0] : data
    if (!current
      || current.type !== ADMIN_BAN_TYPE
      || current.status !== 'active'
      || !Number.isFinite(current.expiresAt)
      || current.expiresAt > now) {
      return false
    }
    const requestId = `expire:${current.caseId}:${current.expiresAt}`
    const updates = {
      status: 'expired',
      expiredAt: now,
      updatedAt: now,
      lastAction: 'expire',
      lastRequestId: requestId,
    }
    await ref.update(updates)
    await transaction.collection(ACCOUNT_RESTRICTION_AUDIT_COLLECTION).add({
      _id: auditId('expire', current._id, requestId),
      action: 'expire',
      userId: current._id,
      caseId: current.caseId,
      operator: 'system',
      requestId,
      createdAt: now,
    })
    return true
  })
}

async function expireAccountRestrictions(db, { now = Date.now(), limit = 1000 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 1000, 1), 1000)
  const { data } = await db.collection(ACCOUNT_RESTRICTIONS_COLLECTION).limit(safeLimit).get()
  const due = (Array.isArray(data) ? data : []).filter(row => row?.type === ADMIN_BAN_TYPE
    && row.status === 'active'
    && Number.isFinite(row.expiresAt)
    && row.expiresAt <= now)
  let expired = 0
  for (const restriction of due) {
    if (await expireOne(db, restriction, now))
      expired += 1
  }
  return { scanned: Array.isArray(data) ? data.length : 0, expired }
}

module.exports = {
  ACCOUNT_RESTRICTIONS_COLLECTION,
  ACCOUNT_RESTRICTION_AUDIT_COLLECTION,
  ADMIN_BAN_TYPE,
  banAccount,
  expireAccountRestrictions,
  publicRestriction,
  unbanAccount,
}
