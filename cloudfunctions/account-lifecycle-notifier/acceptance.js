/** Signed, centrally idempotent SES acceptance sends. */

'use strict'

const { Buffer } = require('node:buffer')
const crypto = require('node:crypto')

const { SES_TEMPLATE_CATALOG } = require('./template-catalog')
const { renderLifecycleEmail } = require('./templates')

const ACCEPTANCE_ACTION = 'send_account_lifecycle_acceptance'
const ACCEPTANCE_COLLECTION = 'account_lifecycle_acceptance_runs'
const ACCEPTANCE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000
const ACCEPTANCE_SIGNATURE_TTL_MS = 5 * 60 * 1000
const ACCEPTANCE_FUTURE_TOLERANCE_MS = 30 * 1000
const DEADLINE_TYPES = new Set([
  'deletion_requested',
  'deletion_reminder_7d',
  'deletion_reminder_1d',
])

function readDoc(result) {
  if (Array.isArray(result?.data))
    return result.data[0] || null
  return result?.data && typeof result.data === 'object' ? result.data : null
}

function requireSigningKey(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') < 32)
    throw new Error('SES_ACCEPTANCE_SIGNING_KEY 必须至少为 32 字节')
  return value
}

function normalizeAcceptanceEvent(event) {
  if (!event || typeof event !== 'object')
    throw new Error('验收请求格式无效')
  if (event.action !== ACCEPTANCE_ACTION)
    throw new Error('验收请求 action 无效')
  if (typeof event.runId !== 'string' || !/^[\w.:-]{1,96}$/.test(event.runId))
    throw new Error('验收批次 ID 无效')
  if (!Object.hasOwn(SES_TEMPLATE_CATALOG, event.type))
    throw new Error('验收模板类型无效')
  if (!Number.isSafeInteger(event.issuedAt))
    throw new Error('验收请求时间无效')

  let deadlineAt = null
  if (DEADLINE_TYPES.has(event.type)) {
    if (!Number.isSafeInteger(event.deadlineAt))
      throw new Error('验收截止时间无效')
    deadlineAt = event.deadlineAt
  }
  else if (event.deadlineAt !== null && event.deadlineAt !== undefined) {
    throw new Error('该验收模板不接受截止时间')
  }

  return {
    action: ACCEPTANCE_ACTION,
    deadlineAt,
    issuedAt: event.issuedAt,
    runId: event.runId,
    type: event.type,
  }
}

function canonicalAcceptancePayload(event) {
  const normalized = normalizeAcceptanceEvent(event)
  return [
    normalized.action,
    normalized.runId,
    normalized.type,
    normalized.deadlineAt ?? '',
    normalized.issuedAt,
  ].join('\n')
}

function createAcceptanceSignature(event, signingKey) {
  return crypto
    .createHmac('sha256', requireSigningKey(signingKey))
    .update(canonicalAcceptancePayload(event))
    .digest('hex')
}

function verifyAcceptanceEvent(event, signingKey, now = Date.now()) {
  const normalized = normalizeAcceptanceEvent(event)
  if (!Number.isFinite(now))
    throw new Error('验收服务时间无效')
  if (normalized.issuedAt > now + ACCEPTANCE_FUTURE_TOLERANCE_MS
    || normalized.issuedAt < now - ACCEPTANCE_SIGNATURE_TTL_MS) {
    throw new Error('验收请求已过期')
  }
  if (typeof event.signature !== 'string' || !/^[a-f0-9]{64}$/.test(event.signature))
    throw new Error('验收请求签名无效')

  const expected = createAcceptanceSignature(normalized, signingKey)
  const actualBuffer = Buffer.from(event.signature, 'hex')
  const expectedBuffer = Buffer.from(expected, 'hex')
  if (!crypto.timingSafeEqual(actualBuffer, expectedBuffer))
    throw new Error('验收请求签名无效')
  return normalized
}

function recipientHash(recipient) {
  return crypto.createHash('sha256').update(recipient.trim().toLowerCase()).digest('hex')
}

function acceptanceKey({ runId, type, recipientHash: hash }) {
  return crypto
    .createHash('sha256')
    .update(`${runId}\0${type}\0${hash}`)
    .digest('hex')
    .slice(0, 48)
}

function createAcceptanceStore(db, {
  collectionName = ACCEPTANCE_COLLECTION,
} = {}) {
  if (!db || typeof db.runTransaction !== 'function')
    throw new TypeError('CloudBase database is required')
  const collection = () => db.collection(collectionName)

  return {
    async reserve(record) {
      return db.runTransaction(async (transaction) => {
        const ref = transaction.collection(collectionName).doc(record.id)
        const existing = readDoc(await ref.get())
        if (existing)
          return { record: existing, reserved: false }

        const stored = {
          kind: 'ses_acceptance_run',
          runId: record.runId,
          type: record.type,
          recipientHash: record.recipientHash,
          status: 'reserved',
          reservedAt: record.now,
          updatedAt: record.now,
          retentionExpiresAt: record.now + ACCEPTANCE_RETENTION_MS,
        }
        await ref.set(stored)
        return { record: { _id: record.id, ...stored }, reserved: true }
      })
    },
    async markSubmitted(id, now, delivery) {
      await collection().doc(id).update({
        status: 'submitted',
        providerMessageId: delivery.id,
        providerRequestId: delivery.requestId || null,
        submittedAt: now,
        updatedAt: now,
      })
    },
    async markFailed(id, now, error) {
      const code = typeof error?.code === 'string' && error.code
        ? error.code.slice(0, 128)
        : 'UnknownError'
      await collection().doc(id).update({
        status: 'failed',
        failedAt: now,
        lastErrorCode: code,
        updatedAt: now,
      })
    },
  }
}

function requiredEmail(value, variableName) {
  const email = typeof value === 'string' ? value.trim() : ''
  const at = email.indexOf('@')
  const domain = email.slice(at + 1)
  if (!email
    || /\s/.test(email)
    || at <= 0
    || at !== email.lastIndexOf('@')
    || !domain.includes('.')
    || domain.startsWith('.')
    || domain.endsWith('.')) {
    throw new Error(`${variableName} 未配置有效邮箱`)
  }
  return email.toLowerCase()
}

function acceptanceRecipient(type, config) {
  return type === 'deletion_cleanup_ops'
    ? requiredEmail(config?.opsEmail, 'SES_OPS_EMAIL')
    : requiredEmail(config?.acceptanceEmail, 'SES_ACCEPTANCE_EMAIL')
}

function acceptanceJob(request, recipient, id) {
  return {
    id: `acceptance-${id}`,
    type: request.type,
    to: recipient,
    deletionScheduledAt: request.deadlineAt,
    metadata: request.type === 'deletion_cleanup_ops'
      ? {
          caseRef: `acceptance-${request.runId}`,
          failureCount: 1,
          errorCode: 'acceptance_test',
        }
      : undefined,
  }
}

function publicResult(record, deduped) {
  return {
    deduped,
    ok: record.status !== 'failed',
    providerMessageId: record.providerMessageId || null,
    status: record.status,
  }
}

async function sendAcceptanceEmail(event, {
  config,
  now = Date.now(),
  send,
  store,
}) {
  if (config?.acceptanceEnabled !== true)
    throw new Error('SES 验收发送未启用')
  if (!store || typeof store.reserve !== 'function')
    throw new TypeError('验收幂等存储未配置')
  if (typeof send !== 'function')
    throw new TypeError('SES 验收发送器未配置')

  const request = verifyAcceptanceEvent(event, config.acceptanceSigningKey, now)
  const recipient = acceptanceRecipient(request.type, config)
  const hash = recipientHash(recipient)
  const id = acceptanceKey({
    recipientHash: hash,
    runId: request.runId,
    type: request.type,
  })
  const reservation = await store.reserve({
    id,
    now,
    recipientHash: hash,
    runId: request.runId,
    type: request.type,
  })
  if (!reservation.reserved)
    return publicResult(reservation.record, true)

  const job = acceptanceJob(request, recipient, id)
  const rendered = renderLifecycleEmail(job)
  try {
    const delivery = await send({
      id: job.id,
      subject: rendered.subject,
      templateData: rendered.templateData,
      to: recipient,
      type: request.type,
    })
    await store.markSubmitted(id, now, delivery)
    return publicResult({
      providerMessageId: delivery.id,
      status: 'submitted',
    }, false)
  }
  catch (error) {
    await store.markFailed(id, now, error)
    throw error
  }
}

module.exports = {
  ACCEPTANCE_ACTION,
  ACCEPTANCE_COLLECTION,
  acceptanceKey,
  canonicalAcceptancePayload,
  createAcceptanceSignature,
  createAcceptanceStore,
  sendAcceptanceEmail,
  verifyAcceptanceEvent,
}
