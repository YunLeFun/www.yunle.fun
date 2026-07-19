/** Delete expired SSO authorization-code and rate-limit records from server-only collections. */

'use strict'

const CODE_COLLECTION = 'sso_login_codes'
const RATE_LIMIT_COLLECTION = 'sso_security_limits'
const MAX_BATCHES = 10
const BATCH_SIZE = 100
const CODE_AUDIT_RETENTION_MS = 24 * 60 * 60 * 1000
const DOCUMENT_ID = /^[a-f0-9]{64}$/

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function assertResult(result, operation) {
  if (!isRecord(result) || (result.code !== undefined && result.code !== 0 && result.code !== '0'))
    throw new Error(`${operation} returned an invalid database result`)
}

async function sweepCollection(database, collectionName, before, options = {}) {
  if (!Number.isSafeInteger(before))
    throw new TypeError('sweep cutoff must be an integer timestamp')
  const batchSize = options.batchSize ?? BATCH_SIZE
  const maxBatches = options.maxBatches ?? MAX_BATCHES
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500
    || !Number.isSafeInteger(maxBatches) || maxBatches < 1 || maxBatches > 100) {
    throw new TypeError('invalid sweep bounds')
  }

  let scanned = 0
  let removed = 0
  for (let batch = 0; batch < maxBatches; batch++) {
    const result = await database.collection(collectionName)
      .where({ expiresAt: database.command.lte(before) })
      .orderBy('expiresAt', 'asc')
      .limit(batchSize)
      .get()
    assertResult(result, `${collectionName} sweep query`)
    const records = Array.isArray(result.data) ? result.data.filter(isRecord) : []
    scanned += records.length
    for (const record of records) {
      if (typeof record._id !== 'string' || !DOCUMENT_ID.test(record._id))
        continue
      const removeResult = await database.collection(collectionName).doc(record._id).remove()
      assertResult(removeResult, `${collectionName} sweep remove`)
      removed++
    }
    if (records.length < batchSize)
      break
  }
  return { scanned, removed }
}

async function runSweep(database, now = Date.now()) {
  if (!Number.isSafeInteger(now))
    throw new TypeError('sweep time must be an integer timestamp')
  const [codes, rateLimits] = await Promise.all([
    sweepCollection(database, CODE_COLLECTION, now - CODE_AUDIT_RETENTION_MS),
    sweepCollection(database, RATE_LIMIT_COLLECTION, now),
  ])
  return { ok: true, codes, rateLimits }
}

exports.main = async function main() {
  const cloudbase = require('@cloudbase/node-sdk')
  const result = await runSweep(cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV }).database())
  console.warn('[sso-security-sweeper] completed', JSON.stringify(result))
  return result
}

exports.CODE_AUDIT_RETENTION_MS = CODE_AUDIT_RETENTION_MS
exports.runSweep = runSweep
exports.sweepCollection = sweepCollection
