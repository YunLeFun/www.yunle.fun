'use strict'

const crypto = require('node:crypto')

const ALLOWED_ACTIONS = new Set(['chat', 'rateLimit'])
const ALLOWED_OUTCOMES = new Set([
  'ai_failed',
  'bad_request',
  'error',
  'forbidden',
  'insufficient',
  'quota_exhausted',
  'rate_limited',
  'success',
  'unauthorized',
  'unknown_app',
])

function auditAction(event) {
  return ALLOWED_ACTIONS.has(event?.action) ? event.action : 'unknown'
}

function auditMessageCount(event) {
  return Array.isArray(event?.messages)
    ? Math.min(event.messages.length, 33)
    : 0
}

function auditOutcome(result) {
  if (result && typeof result === 'object' && ALLOWED_OUTCOMES.has(result.code))
    return result.code
  return result?.ok === true ? 'success' : 'error'
}

function auditRequestId(context) {
  const candidate = context?.requestId || context?.request_id || ''
  return typeof candidate === 'string' && /^[\w.:-]{8,128}$/.test(candidate)
    ? candidate
    : crypto.randomUUID()
}

function buildAuditRecord({ action, durationMs, messageCount, outcome, requestId }) {
  return {
    action: ALLOWED_ACTIONS.has(action) ? action : 'unknown',
    durationMs: Math.max(0, Math.round(Number(durationMs) || 0)),
    messageCount: Math.max(0, Math.min(33, Math.round(Number(messageCount) || 0))),
    outcome: ALLOWED_OUTCOMES.has(outcome) ? outcome : 'error',
    requestId: auditRequestId({ requestId }),
  }
}

function emitAuditLog(logger, record) {
  try {
    logger(`[ai-gateway] ${JSON.stringify(record)}`)
  }
  catch {
    // Logging must never change the request outcome.
  }
}

module.exports = {
  auditAction,
  auditMessageCount,
  auditOutcome,
  auditRequestId,
  buildAuditRecord,
  emitAuditLog,
}
