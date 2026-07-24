/** CloudBase adapter for reward-claim campaign state, transactions, rate limits and outbox. */

'use strict'

const crypto = require('node:crypto')

const { RewardClaimError } = require('./reward-claim-campaigns')

const REWARD_CLAIM_CAMPAIGNS_COLLECTION = 'reward_claim_campaigns'
const REWARD_CLAIM_LINKS_COLLECTION = 'reward_claim_links'
const REWARD_CLAIMS_COLLECTION = 'reward_claims'
const REWARD_CLAIM_AUDITS_COLLECTION = 'reward_claim_audit_logs'
const REWARD_CLAIM_RATE_LIMITS_COLLECTION = 'reward_claim_rate_limits'
const REWARD_CLAIM_ALERTS_COLLECTION = 'reward_claim_alerts'
const TRANSACTION_BUSY_RETRY_DELAYS_MS = [60, 180, 420]

function docData(result) {
  if (Array.isArray(result?.data))
    return result.data[0] || null
  return result?.data && typeof result.data === 'object' ? result.data : null
}

function rows(result) {
  return Array.isArray(result?.data) ? result.data : []
}

function withoutUndefined(value) {
  if (Array.isArray(value))
    return value.map(withoutUndefined)
  if (!value || typeof value !== 'object')
    return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, withoutUndefined(item)]),
  )
}

async function setDocument(database, collectionName, document) {
  if (!document || typeof document._id !== 'string' || !document._id)
    throw new RewardClaimError('data_inconsistent', `${collectionName} 文档缺少稳定 _id`, 503)
  const { _id, ...fields } = withoutUndefined(document)
  await database.collection(collectionName).doc(_id).set(fields)
}

async function readDocument(database, collectionName, id) {
  if (typeof id !== 'string' || !id)
    return null
  return docData(await database.collection(collectionName).doc(id).get())
}

function isTransactionBusy(error) {
  return error?.code === 'ResourceUnavailable.TransactionBusy'
    || (typeof error?.message === 'string'
      && error.message.includes('[ResourceUnavailable.TransactionBusy]'))
}

async function runTransactionWithRetry(db, callback, options = {}) {
  const sleep = options.sleep || (async delay => await new Promise(resolve => setTimeout(resolve, delay)))
  let retry = 0
  while (true) {
    try {
      return await db.runTransaction(callback)
    }
    catch (error) {
      const delay = TRANSACTION_BUSY_RETRY_DELAYS_MS[retry]
      if (delay === undefined || !isTransactionBusy(error))
        throw error
      retry++
      await sleep(delay)
    }
  }
}

function transactionPort(transaction) {
  return {
    getCampaign: id => readDocument(transaction, REWARD_CLAIM_CAMPAIGNS_COLLECTION, id),
    async findCampaignByCode(code) {
      const result = await transaction
        .collection(REWARD_CLAIM_CAMPAIGNS_COLLECTION)
        .where({ code })
        .limit(2)
        .get()
      const items = rows(result)
      if (items.length > 1)
        throw new RewardClaimError('data_inconsistent', '活动内部标识存在重复记录', 503)
      return items[0] || null
    },
    setCampaign: campaign => setDocument(
      transaction,
      REWARD_CLAIM_CAMPAIGNS_COLLECTION,
      campaign,
    ),
    getLink: digest => readDocument(transaction, REWARD_CLAIM_LINKS_COLLECTION, digest),
    async listActiveLinks(campaignId) {
      return rows(await transaction
        .collection(REWARD_CLAIM_LINKS_COLLECTION)
        .where({ campaignId, status: 'active' })
        .limit(100)
        .get())
    },
    setLink: link => setDocument(transaction, REWARD_CLAIM_LINKS_COLLECTION, link),
    getClaim: claimId => readDocument(transaction, REWARD_CLAIMS_COLLECTION, claimId),
    setClaim: claim => setDocument(transaction, REWARD_CLAIMS_COLLECTION, claim),
    appendAudit: audit => setDocument(transaction, REWARD_CLAIM_AUDITS_COLLECTION, audit),
    async putAlert(alert) {
      const existing = await readDocument(transaction, REWARD_CLAIM_ALERTS_COLLECTION, alert._id)
      if (!existing)
        await setDocument(transaction, REWARD_CLAIM_ALERTS_COLLECTION, alert)
    },
  }
}

function normalizePage(input = {}) {
  const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 100)
  const skip = Math.max(Number(input.skip) || 0, 0)
  return { limit, skip }
}

function pageResult(items, limit, skip) {
  return {
    items,
    nextSkip: items.length === limit ? skip + limit : null,
  }
}

function createCloudbaseRewardClaimStore(db, options = {}) {
  if (!db || typeof db.runTransaction !== 'function')
    throw new Error('CloudBase db is required')
  return {
    runTransaction: callback => runTransactionWithRetry(
      db,
      transaction => callback(transactionPort(transaction)),
      options,
    ),
    getCampaign: id => readDocument(db, REWARD_CLAIM_CAMPAIGNS_COLLECTION, id),
    getLink: digest => readDocument(db, REWARD_CLAIM_LINKS_COLLECTION, digest),
    getClaim: claimId => readDocument(db, REWARD_CLAIMS_COLLECTION, claimId),
    async listCampaigns(input = {}) {
      const { limit, skip } = normalizePage(input)
      const items = rows(await db
        .collection(REWARD_CLAIM_CAMPAIGNS_COLLECTION)
        .orderBy('createdAt', 'desc')
        .skip(skip)
        .limit(limit)
        .get())
      return pageResult(items, limit, skip)
    },
    async listClaims(input = {}) {
      const { limit, skip } = normalizePage(input)
      if (typeof input.campaignId !== 'string' || !input.campaignId)
        throw new RewardClaimError('invalid_input', 'campaignId 必填')
      const query = { campaignId: input.campaignId }
      if (typeof input.status === 'string' && input.status)
        query.status = input.status
      const items = rows(await db
        .collection(REWARD_CLAIMS_COLLECTION)
        .where(query)
        .orderBy('createdAt', 'desc')
        .skip(skip)
        .limit(limit)
        .get())
      return pageResult(items, limit, skip)
    },
    async listAudits(input = {}) {
      const { limit, skip } = normalizePage(input)
      if (typeof input.campaignId !== 'string' || !input.campaignId)
        throw new RewardClaimError('invalid_input', 'campaignId 必填')
      const items = rows(await db
        .collection(REWARD_CLAIM_AUDITS_COLLECTION)
        .where({ campaignId: input.campaignId })
        .orderBy('createdAt', 'desc')
        .skip(skip)
        .limit(limit)
        .get())
      return pageResult(items, limit, skip)
    },
    async listAlerts(input = {}) {
      const { limit, skip } = normalizePage(input)
      if (typeof input.campaignId !== 'string' || !input.campaignId)
        throw new RewardClaimError('invalid_input', 'campaignId 必填')
      const items = rows(await db
        .collection(REWARD_CLAIM_ALERTS_COLLECTION)
        .where({ campaignId: input.campaignId })
        .orderBy('createdAt', 'desc')
        .skip(skip)
        .limit(limit)
        .get())
      return pageResult(items, limit, skip)
    },
  }
}

function counterId(scope, campaignKey, subjectHash, windowStartedAt) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(['reward_claim_rate', scope, campaignKey, subjectHash, windowStartedAt]))
    .digest('hex')
}

function assertRateSubject(value, field) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 256)
    throw new RewardClaimError('rate_limit_identity_invalid', `${field} 无效`, 503)
  return value
}

function createCloudbaseRewardClaimRateLimit(db, options = {}) {
  const accountLimit = Number(options.accountLimit) || 5
  const ipLimit = Number(options.ipLimit) || 20
  const windowMs = Number(options.windowMs) || 60_000
  if (!Number.isSafeInteger(accountLimit) || accountLimit < 1
    || !Number.isSafeInteger(ipLimit) || ipLimit < 1
    || !Number.isSafeInteger(windowMs) || windowMs < 1000) {
    throw new Error('invalid reward claim rate-limit configuration')
  }

  async function increment(transaction, input, scope, subjectHash, limit, windowStartedAt) {
    const id = counterId(scope, input.campaignKey, subjectHash, windowStartedAt)
    const ref = transaction.collection(REWARD_CLAIM_RATE_LIMITS_COLLECTION).doc(id)
    const existing = docData(await ref.get())
    if (existing && (existing.scope !== scope
      || existing.campaignKey !== input.campaignKey
      || existing.subjectHash !== subjectHash
      || existing.windowStartedAt !== windowStartedAt)) {
      throw new RewardClaimError('data_inconsistent', '领取限流计数器归属冲突', 503)
    }
    const count = (existing?.count || 0) + 1
    if (count > limit)
      throw new RewardClaimError('rate_limited', '请求过于频繁，请稍后再试', 429)
    const document = {
      scope,
      campaignKey: input.campaignKey,
      subjectHash,
      windowStartedAt,
      count,
      expiresAt: windowStartedAt + windowMs * 2,
      updatedAt: input.now,
      ...(existing ? {} : { createdAt: input.now }),
    }
    if (existing)
      await ref.update(document)
    else
      await ref.set(document)
  }

  return {
    async consume(input) {
      assertRateSubject(input?.campaignKey, 'campaignKey')
      const accountHash = assertRateSubject(input?.accountHash, 'accountHash')
      const ipHash = assertRateSubject(input?.ipHash, 'ipHash')
      if (!Number.isSafeInteger(input?.now))
        throw new RewardClaimError('rate_limit_time_invalid', '限流时间无效', 503)
      const windowStartedAt = Math.floor(input.now / windowMs) * windowMs
      await runTransactionWithRetry(db, async (transaction) => {
        await increment(transaction, input, 'account', accountHash, accountLimit, windowStartedAt)
        await increment(transaction, input, 'ip', ipHash, ipLimit, windowStartedAt)
      }, options)
    },
  }
}

module.exports = {
  REWARD_CLAIM_ALERTS_COLLECTION,
  REWARD_CLAIM_AUDITS_COLLECTION,
  REWARD_CLAIM_CAMPAIGNS_COLLECTION,
  REWARD_CLAIM_LINKS_COLLECTION,
  REWARD_CLAIM_RATE_LIMITS_COLLECTION,
  REWARD_CLAIMS_COLLECTION,
  TRANSACTION_BUSY_RETRY_DELAYS_MS,
  createCloudbaseRewardClaimRateLimit,
  createCloudbaseRewardClaimStore,
  runTransactionWithRetry,
}
