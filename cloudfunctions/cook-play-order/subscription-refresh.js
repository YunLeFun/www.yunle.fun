'use strict'

const { Buffer } = require('node:buffer')
const { createCipheriv, createDecipheriv, hkdfSync, randomBytes, randomUUID } = require('node:crypto')
const { PACKAGE, PlayOrderError, assertValidToken, purchaseReference } = require('./purchase-proof')

const PLAY_SUBSCRIPTIONS = 'play_subscription_progress'
const TRIGGER_NAME = 'cookPlaySubscriptionRefresh'
const REFRESH_CRON = '0 * * * * * *'
const MINUTE = 60_000
const TOKEN_RETENTION_MS = 60 * 24 * 60 * MINUTE
const LEASE_MS = 2 * MINUTE
const BATCH_SIZE = 16
const PARALLELISM = 4
const START_BUDGET_MS = 15_000

function tokenCipher(key, ledgerEnvironment) {
  const scope = `${PACKAGE}:${ledgerEnvironment}`
  const encryptionKey = hkdfSync('sha256', Buffer.from(key), scope, 'cook-play-subscription-refresh:v1', 32)
  const associatedData = reference => Buffer.from(`${scope}:${reference}:v1`)
  return {
    seal(token, reference) {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv)
      cipher.setAAD(associatedData(reference))
      const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
      return `v1.${iv.toString('base64url')}.${encrypted.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}`
    },
    open(value, reference) {
      try {
        const parts = typeof value === 'string'
          && /^v1\.([\w-]{16})\.([\w-]{22,2731})\.([\w-]{22})$/.exec(value)
        if (!parts)
          throw new Error('invalid envelope')
        const [, iv, ciphertext, tag] = parts
        const decipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(iv, 'base64url'))
        decipher.setAAD(associatedData(reference))
        decipher.setAuthTag(Buffer.from(tag, 'base64url'))
        const clear = Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8')
        assertValidToken(clear)
        if (purchaseReference(clear) !== reference)
          throw new Error('invalid reference')
        return clear
      }
      catch {
        throw new PlayOrderError('invalid_refresh_job')
      }
    },
  }
}

function readResult(result) {
  if (result?.code)
    throw new PlayOrderError('play_unavailable')
  return result?.data
}

function withoutSchedule(doc) {
  const {
    _id,
    encryptedPurchaseToken,
    nextRefreshAt,
    refreshUntil,
    refreshAttempts,
    refreshLease,
    ...rest
  } = doc
  return rest
}

function due(doc, now) {
  return Number.isSafeInteger(doc?.nextRefreshAt) && doc.nextRefreshAt > 0 && doc.nextRefreshAt <= now
}

function createSubscriptionRefresh({ db, key, ledgerEnvironment, clock }) {
  const cipher = tokenCipher(key, ledgerEnvironment)

  async function withProgress(reference, change) {
    const result = await db.runTransaction(async (transaction) => {
      const docRef = transaction.collection(PLAY_SUBSCRIPTIONS).doc(reference.slice(0, 40))
      const value = readResult(await docRef.get())
      const doc = Array.isArray(value) ? value[0] : value
      if (doc?.purchaseReference !== reference)
        return null
      return change(doc, async next => readResult(await docRef.set(next)))
    })
    if (result?.code)
      throw new PlayOrderError('play_unavailable')
    return result
  }

  async function record(token, observedAt, subscription, status) {
    const reference = purchaseReference(token)
    const expiry = subscription.periodExpiresAt
    const now = clock()
    const retry = status === 'pending' || status === 'committed'
    const open = subscription.state === 'active' || subscription.state === 'grace'
      || (subscription.state === 'cancelled' && expiry > now)
    const validExpiry = Number.isSafeInteger(expiry) && expiry > 0 && expiry + TOKEN_RETENTION_MS > now
    await withProgress(reference, async (doc, write) => {
      const scheduled = validExpiry && (retry || open)
      if (doc.replacementReference || observedAt < doc.refreshObservedAt
        || (observedAt === doc.refreshObservedAt && doc.refreshClosed && scheduled)) {
        return
      }
      const next = { ...withoutSchedule(doc), refreshObservedAt: observedAt, refreshClosed: !scheduled }
      if (scheduled) {
        next.encryptedPurchaseToken = doc.encryptedPurchaseToken || cipher.seal(token, reference)
        next.nextRefreshAt = retry || expiry <= now ? now + MINUTE : expiry
        next.refreshUntil = expiry + TOKEN_RETENTION_MS
        next.refreshAttempts = 0
      }
      await write(next)
    })
  }

  async function claim(reference) {
    return withProgress(reference, async (doc, write) => {
      const now = clock()
      if (!due(doc, now))
        return null
      if (!Number.isSafeInteger(doc.refreshUntil) || doc.refreshUntil <= now) {
        await write({ ...withoutSchedule(doc), refreshClosed: true })
        return null
      }
      const lease = randomUUID()
      const { _id, ...current } = doc
      // If the cloud invocation stops mid-check, the due time makes the job claimable again.
      await write({ ...current, nextRefreshAt: now + LEASE_MS, refreshLease: lease })
      return { lease, encrypted: doc.encryptedPurchaseToken }
    })
  }

  async function finish(reference, lease, stop) {
    return withProgress(reference, async (doc, write) => {
      // A more recent device check or notification may have already advanced the schedule.
      if (doc.refreshLease !== lease)
        return 'processed'
      if (stop || doc.refreshUntil <= clock()) {
        await write({ ...withoutSchedule(doc), refreshClosed: true })
        return 'stopped'
      }
      const { _id, refreshLease, ...current } = doc
      const attempts = Math.min(6, (doc.refreshAttempts || 0) + 1)
      await write({ ...current, nextRefreshAt: clock() + MINUTE * 2 ** (attempts - 1), refreshAttempts: attempts })
      return 'retried'
    })
  }

  async function run(refresh) {
    const now = clock()
    const response = await db.collection(PLAY_SUBSCRIPTIONS)
      .where({ nextRefreshAt: db.command.lte(now) })
      .orderBy('nextRefreshAt', 'asc')
      .limit(BATCH_SIZE)
      .get()
    const rows = readResult(response)
    if (!Array.isArray(rows))
      throw new PlayOrderError('play_unavailable')
    const totals = { processed: 0, retried: 0, stopped: 0, skipped: 0 }
    const runOne = async (row) => {
      const reference = row?.purchaseReference
      if (!/^[0-9a-f]{64}$/.test(reference) || row._id !== reference.slice(0, 40))
        return 'skipped'
      const job = await claim(reference)
      if (!job)
        return 'skipped'
      let stop = false
      try {
        const token = cipher.open(job.encrypted, reference)
        const outcome = await refresh(token)
        stop = ['unregistered_owner', 'other_ledger', 'ignored'].includes(outcome)
      }
      catch (error) {
        stop = ['invalid_refresh_job', 'account_deletion_finalizing', 'play_sandbox_account_forbidden'].includes(error?.code)
      }
      return finish(reference, job.lease, stop)
    }
    for (let start = 0; start < rows.length && clock() - now < START_BUDGET_MS; start += PARALLELISM) {
      const outcomes = await Promise.allSettled(rows.slice(start, start + PARALLELISM).map(runOne))
      for (const result of outcomes) {
        const outcome = result.status === 'fulfilled' ? result.value : 'retried'
        totals[outcome ?? 'skipped']++
      }
    }
    return totals
  }

  return { record, run }
}

function createRefreshHandler({ enabled, isTimer, getService, checkAccount, onFailure = () => {} }) {
  return async (event) => {
    if (!isTimer() || event?.Type !== 'Timer' || event.TriggerName !== TRIGGER_NAME)
      return { code: 'timer_required' }
    if (!enabled())
      return { code: 'play_not_configured' }
    try {
      return { ok: true, ...await getService().refreshSubscriptions(checkAccount) }
    }
    catch {
      onFailure('refresh_unavailable')
      return { code: 'refresh_unavailable' }
    }
  }
}

module.exports = { PLAY_SUBSCRIPTIONS, REFRESH_CRON, TRIGGER_NAME, createRefreshHandler, createSubscriptionRefresh, withoutSchedule }
