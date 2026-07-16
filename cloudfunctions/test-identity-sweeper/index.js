/** CloudBase timer bridge for the admin test-identity sweep endpoint. */

'use strict'

const { Buffer } = require('node:buffer')
const { createHash, createHmac, randomUUID } = require('node:crypto')
const process = require('node:process')

const ADMIN_SWEEP_URL = 'https://admin.yunle.fun/api/internal/test-identities/sweep'

function decodeSweepKey(rawKey) {
  if (typeof rawKey !== 'string' || !/^[a-z0-9+/]{43}=$/i.test(rawKey))
    throw new Error('TEST_BROKER_SWEEP_KEY must be canonical 32-byte base64')
  const key = Buffer.from(rawKey, 'base64')
  if (key.length !== 32 || key.toString('base64') !== rawKey)
    throw new Error('TEST_BROKER_SWEEP_KEY must be canonical 32-byte base64')
  return key
}

function signRequest(timestamp, nonce, body, rawKey) {
  if (!/^(?:0|[1-9]\d{0,15})$/.test(timestamp))
    throw new Error('sweep timestamp is invalid')
  if (!/^[\w-]{8,128}$/.test(nonce))
    throw new Error('sweep nonce is invalid')
  const bodyDigest = createHash('sha256').update(body, 'utf8').digest('hex')
  return createHmac('sha256', decodeSweepKey(rawKey))
    .update(`${timestamp}\n${nonce}\n${bodyDigest}`, 'utf8')
    .digest('base64url')
}

async function invokeAdminSweep(options = {}) {
  const now = Number.isSafeInteger(options.now) ? options.now : Date.now()
  const nonce = typeof options.nonce === 'string' ? options.nonce : randomUUID()
  const key = options.key ?? process.env.TEST_BROKER_SWEEP_KEY ?? ''
  const fetchImpl = options.fetchImpl ?? fetch
  const body = '{}'
  const timestamp = String(now)
  const signature = signRequest(timestamp, nonce, body, key)
  const response = await fetchImpl(ADMIN_SWEEP_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-sweep-nonce': nonce,
      'x-sweep-signature': signature,
      'x-sweep-timestamp': timestamp,
    },
    body,
    redirect: 'error',
    signal: AbortSignal.timeout(8_000),
  })
  if (!response?.ok)
    throw new Error(`admin test-identity sweep failed with HTTP ${response?.status || 0}`)
  const result = await response.json()
  assertSweepResult(result)
  return { ok: true, ...result }
}

function assertSweepResult(result) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.released)
    || !Array.isArray(result.purged) || !Number.isSafeInteger(result.cleanupRuns)
    || result.cleanupRuns < 0 || !Number.isSafeInteger(result.ticketIssuancesReconciled)
    || result.ticketIssuancesReconciled < 0
    || !result.reconciled || typeof result.reconciled !== 'object') {
    throw new Error('admin test-identity sweep returned an invalid result')
  }
  for (const key of ['scanned', 'settled', 'released', 'manual', 'skipped', 'errors']) {
    const value = result.reconciled[key]
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error('admin test-identity sweep returned an invalid result')
  }
}

exports.main = async () => invokeAdminSweep()
exports.ADMIN_SWEEP_URL = ADMIN_SWEEP_URL
exports.invokeAdminSweep = invokeAdminSweep
exports.signRequest = signRequest
