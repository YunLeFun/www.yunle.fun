'use strict'

const { Buffer } = require('node:buffer')
const crypto = require('node:crypto')

const DEFAULT_MAX_CLOCK_SKEW_MS = 120_000

function hashMessages(messages) {
  return crypto.createHash('sha256').update(JSON.stringify(messages)).digest('hex')
}

function createSigningPayload({ appId, bizId, timestamp, messages }) {
  return [
    'v1',
    appId,
    bizId,
    String(timestamp),
    hashMessages(messages),
  ].join('\n')
}

function signAppRequest(secret, input) {
  if (typeof secret !== 'string' || !secret)
    throw new Error('应用签名密钥未配置')
  return crypto.createHmac('sha256', secret).update(createSigningPayload(input)).digest('hex')
}

function timingSafeEqualString(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string')
    return false
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  if (leftBuffer.length !== rightBuffer.length)
    return false
  return crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

function verifyAppRequest(secret, input, options = {}) {
  const now = options.now ?? Date.now()
  const maxClockSkewMs = options.maxClockSkewMs ?? DEFAULT_MAX_CLOCK_SKEW_MS
  const timestamp = Number(input?.timestamp)
  const signature = input?.signature

  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > maxClockSkewMs)
    return false

  let expected = ''
  try {
    expected = signAppRequest(secret, { ...input, timestamp })
  }
  catch {
    return false
  }
  return timingSafeEqualString(signature, expected)
}

module.exports = {
  DEFAULT_MAX_CLOCK_SKEW_MS,
  createSigningPayload,
  hashMessages,
  signAppRequest,
  verifyAppRequest,
}
