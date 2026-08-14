/** Privacy-safe structured audit records for SSO authorization flows. */

'use strict'

const { createHash } = require('node:crypto')

function auditId(value) {
  return createHash('sha256').update(String(value || 'unknown')).digest('hex').slice(0, 16)
}

function buildAuthorizationResolvedAudit(resolved) {
  return {
    event: 'sso_authorization_resolved',
    clientId: resolved.request.clientId,
    appId: resolved.presentation.appId,
    issuer: resolved.issuer,
    origin: resolved.request.targetOrigin,
    policyVersion: resolved.policyVersion,
    registrationFingerprint: resolved.registrationFingerprint,
  }
}

function buildSsoCodeIssuedAudit(uid, request) {
  return {
    event: 'sso_code_issued',
    subject: auditId(uid),
    flowId: auditId(request.nonce),
    clientId: request.clientId,
    appId: request.appId,
    issuer: request.issuer,
    scopes: request.scopes,
    origin: request.targetOrigin,
    policyVersion: request.policyVersion,
    registrationFingerprint: request.registrationFingerprint,
  }
}

function buildSsoCodeConsumedAudit(uid, request, requestOrigin) {
  return {
    event: 'sso_code_consumed',
    subject: auditId(uid),
    flowId: auditId(request.nonce),
    clientId: request.clientId,
    appId: request.appId,
    issuer: request.issuer,
    scopes: request.scopes,
    origin: requestOrigin,
    policyVersion: request.policyVersion,
    registrationFingerprint: request.registrationFingerprint,
  }
}

function buildSsoRequestRejectedAudit(reason, requestOrigin) {
  return {
    event: 'sso_request_rejected',
    reason,
    origin: requestOrigin || undefined,
  }
}

function emitSecurityAudit(record, logger = console.warn) {
  logger('[sso-ticket] security_event', JSON.stringify(record))
}

module.exports = {
  buildAuthorizationResolvedAudit,
  buildSsoCodeConsumedAudit,
  buildSsoCodeIssuedAudit,
  buildSsoRequestRejectedAudit,
  emitSecurityAudit,
}
