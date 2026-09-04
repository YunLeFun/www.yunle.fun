/** Authenticated Provider/Admin transport for Registry approval delivery. */

'use strict'

const { Buffer } = require('node:buffer')
const { createHash, createHmac, timingSafeEqual } = require('node:crypto')
const process = require('node:process')

const { RegistryAdminError } = require('./service')

const MAX_CLOCK_SKEW_MS = 60_000

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

function signature(secret, method, path, timestamp, body) {
  return createHmac('sha256', secret)
    .update(`${method}\n${path}\n${timestamp}\n${digest(body)}`)
    .digest('hex')
}

function secureEqual(first, second) {
  const left = Buffer.from(String(first || ''))
  const right = Buffer.from(String(second || ''))
  return left.length === 64 && left.length === right.length && timingSafeEqual(left, right)
}

function loadAdminChannelConfig(env = process.env) {
  const enabled = String(env.SSO_REGISTRY_FEISHU_APPROVAL_ENABLED || '') === 'true'
  if (!enabled)
    return { enabled: false }
  const secret = String(env.SSO_REGISTRY_ADMIN_CHANNEL_SECRET || '')
  if (Buffer.byteLength(secret, 'utf8') < 32)
    throw new Error('SSO_REGISTRY_ADMIN_CHANNEL_SECRET must be at least 32 bytes')
  const baseUrl = String(env.SSO_REGISTRY_ADMIN_BASE_URL || 'https://admin.yunle.fun')
  let parsed
  try {
    parsed = new URL(baseUrl)
  }
  catch {}
  if (!parsed
    || parsed.protocol !== 'https:'
    || parsed.origin !== baseUrl
    || parsed.hostname !== 'admin.yunle.fun') {
    throw new Error('SSO_REGISTRY_ADMIN_BASE_URL must be https://admin.yunle.fun')
  }
  return { enabled: true, baseUrl, secret }
}

function createAdminChannelClient(config, options = {}) {
  if (!config?.enabled)
    return null
  const fetchImpl = options.fetchImpl || globalThis.fetch
  const now = options.now || Date.now
  if (typeof fetchImpl !== 'function')
    throw new TypeError('fetch is unavailable')

  async function call(path, payload) {
    const body = JSON.stringify(payload)
    const timestamp = String(now())
    const response = await fetchImpl(`${config.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-yunlefun-registry-signature': signature(config.secret, 'POST', path, timestamp, body),
        'x-yunlefun-registry-timestamp': timestamp,
      },
      body,
      signal: AbortSignal.timeout(5_000),
    })
    if (!response?.ok)
      throw new RegistryAdminError('admin_channel_request_failed')
    const result = await response.json()
    if (!result?.ok || !result.data || typeof result.data !== 'object')
      throw new RegistryAdminError('admin_channel_response_invalid')
    return result.data
  }

  return {
    notifyApprovalCard: payload => call('/api/internal/sso-registry/approvals/status', payload),
    sendApprovalCard: payload => call('/api/internal/sso-registry/approvals/deliver', payload),
  }
}

function createAdminChannelRequestVerifier(secret, options = {}) {
  if (Buffer.byteLength(String(secret || ''), 'utf8') < 32)
    throw new TypeError('Admin channel secret must be at least 32 bytes')
  const now = options.now || Date.now
  return (request) => {
    const action = String(request?.action || '')
    const approvalId = String(request?.approvalId || '')
    const timestamp = Number(request?.channelTimestamp)
    if (!Number.isSafeInteger(timestamp)
      || Math.abs(now() - timestamp) > MAX_CLOCK_SKEW_MS
      || !action
      || !approvalId) {
      throw new RegistryAdminError('admin_channel_identity_required')
    }
    const body = JSON.stringify({ action, approvalId })
    const expected = signature(secret, 'CLOUDBASE', action, String(timestamp), body)
    if (!secureEqual(request?.channelSignature, expected))
      throw new RegistryAdminError('admin_channel_identity_required')
  }
}

function signAdminChannelInvocation(secret, action, approvalId, timestamp = Date.now()) {
  const body = JSON.stringify({ action, approvalId })
  return {
    channelTimestamp: timestamp,
    channelSignature: signature(secret, 'CLOUDBASE', action, String(timestamp), body),
  }
}

module.exports = {
  createAdminChannelClient,
  createAdminChannelRequestVerifier,
  loadAdminChannelConfig,
  signAdminChannelInvocation,
  signature,
}
