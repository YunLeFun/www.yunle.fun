'use strict'

const crypto = require('node:crypto')

const IP_RATE_LIMIT_COLLECTION = 'ai_rate_limits'

function rateLimitDocumentId({ appId, clientKey }) {
  return crypto
    .createHash('sha256')
    .update(`${appId}\n${clientKey}`)
    .digest('hex')
}

function isDuplicateDocumentError(error) {
  if (!error || typeof error !== 'object')
    return false
  const code = typeof error.code === 'string' ? error.code : ''
  const message = typeof error.message === 'string' ? error.message : ''
  return code === 'DATABASE_DUPLICATE_KEY'
    || code === 'DUPLICATE_KEY'
    || /duplicate|E11000/i.test(message)
}

async function ensureRateLimitDocument(collection, document) {
  try {
    await collection.add(document)
  }
  catch (error) {
    if (!isDuplicateDocumentError(error))
      throw error
  }
}

function readUpdatedCount(result) {
  return typeof result?.updated === 'number' ? result.updated : 0
}

async function readRateLimitState(collection, id) {
  const snapshot = await collection.doc(id).get()
  return Array.isArray(snapshot?.data) ? snapshot.data[0] : null
}

async function reserveIpRateLimit(db, {
  appId,
  blockMs,
  clientKey,
  limit,
  now = Date.now(),
  windowMs,
}) {
  const id = rateLimitDocumentId({ appId, clientKey })
  const collection = db.collection(IP_RATE_LIMIT_COLLECTION)
  const _ = db.command

  await ensureRateLimitDocument(collection, {
    _id: id,
    appId,
    blockedUntil: 0,
    count: 0,
    createdAt: now,
    updatedAt: now,
    windowStartedAt: now,
  })

  const reset = await collection
    .where({
      _id: id,
      blockedUntil: _.lte(now),
      windowStartedAt: _.lte(now - windowMs),
    })
    .update({
      blockedUntil: 0,
      count: 1,
      updatedAt: now,
      windowStartedAt: now,
    })
  if (readUpdatedCount(reset) === 1) {
    return {
      allowed: true,
      documentId: id,
      limit,
      remaining: Math.max(0, limit - 1),
    }
  }

  const increment = await collection
    .where({
      _id: id,
      blockedUntil: _.lte(now),
      count: _.lt(limit),
      windowStartedAt: _.gt(now - windowMs),
    })
    .update({ count: _.inc(1), updatedAt: now })
  if (readUpdatedCount(increment) === 1) {
    const state = await readRateLimitState(collection, id)
    const count = typeof state?.count === 'number' ? state.count : limit
    return {
      allowed: true,
      documentId: id,
      limit,
      remaining: Math.max(0, limit - count),
    }
  }

  await collection
    .where({
      _id: id,
      blockedUntil: _.lte(now),
      count: _.gte(limit),
      windowStartedAt: _.gt(now - windowMs),
    })
    .update({ blockedUntil: now + blockMs, updatedAt: now })

  const state = await readRateLimitState(collection, id)
  const blockedUntil = typeof state?.blockedUntil === 'number' ? state.blockedUntil : now + blockMs
  return {
    allowed: false,
    documentId: id,
    limit,
    remaining: 0,
    retryAfterSeconds: Math.max(1, Math.ceil((blockedUntil - now) / 1000)),
  }
}

async function runIpRateLimit(input, deps) {
  const reservation = await deps.reserve(input)
  return reservation.allowed
    ? {
        allowed: true,
        limit: reservation.limit,
        ok: true,
        remaining: reservation.remaining,
      }
    : {
        allowed: false,
        code: 'rate_limited',
        limit: reservation.limit,
        ok: true,
        remaining: 0,
        retryAfterSeconds: reservation.retryAfterSeconds,
      }
}

module.exports = {
  IP_RATE_LIMIT_COLLECTION,
  rateLimitDocumentId,
  reserveIpRateLimit,
  runIpRateLimit,
}
