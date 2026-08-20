/** Synthetic identity mutation guard and trusted wallet settlement. */

'use strict'

const { Buffer } = require('node:buffer')
const crypto = require('node:crypto')
const process = require('node:process')

const { COIN_TX_COLLECTION, WALLET_COLLECTION } = require('./lib/wallet')

const ALLOWED_SESSION_ACTIONS = new Set([
  'getAccount',
  'getMyAiPointAccount',
  'listMyAiPointTransactions',
  'listTransactions',
])
const FIXED_ACCOUNT_ALLOWED_SESSION_ACTIONS = new Set([
  'deductCoin',
  'getAccount',
  'getAccountAccessStatus',
  'getMembership',
  'getMyAiPointAccount',
  'listOrders',
  'listMyAiPointTransactions',
  'listTransactions',
])
const SYNTHETIC_BASELINE_COIN_MAX = 20

class SyntheticAccountError extends Error {
  constructor(code, message, httpStatus = 403) {
    super(message)
    this.name = 'SyntheticAccountError'
    this.code = code
    this.httpStatus = httpStatus
  }
}

function stableId(namespace, ...parts) {
  return crypto.createHash('sha256')
    .update(JSON.stringify([namespace, ...parts]))
    .digest('hex')
    .slice(0, 24)
}

function timingSafeTokenMatch(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string' || !provided || !expected)
    return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function isSecureServiceToken(value) {
  const length = typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : 0
  return length >= 32 && length <= 512
}

async function classifyAccountIdentity(db, uid) {
  try {
    const result = await db.collection('test_identities').where({ uid }).limit(2).get()
    if (!result || !Array.isArray(result.data))
      throw new Error('invalid classification result')
    if (result.data.length === 0)
      return { synthetic: false }
    if (result.data.length !== 1
      || result.data[0]?.uid !== uid
      || result.data[0]?.synthetic !== true
      || typeof result.data[0]?._id !== 'string') {
      throw new Error('ambiguous synthetic classification')
    }
    return { synthetic: true, identity: result.data[0] }
  }
  catch {
    throw new SyntheticAccountError(
      'synthetic_classification_unavailable',
      '测试身份分类服务暂时不可用。',
      503,
    )
  }
}

function isReadyFixedSyntheticIdentity(
  identity,
  expectedEnvironment = process.env.YUNLEFUN_TEST_ACCOUNT_ENVIRONMENT,
) {
  return identity?.synthetic === true
    && identity.accountKind === 'fixed'
    && identity.status === 'ready'
    && (expectedEnvironment === 'test' || expectedEnvironment === 'production')
    && identity.environment === expectedEnvironment
}

function fixedSyntheticTransactionMeta(identity, meta) {
  return {
    ...(meta && typeof meta === 'object' ? meta : {}),
    fixedTestAccount: true,
    synthetic: true,
    syntheticEnvironment: identity.environment,
    syntheticIdentityId: identity._id,
  }
}

function assertSyntheticSessionAction(action, identity) {
  const allowedActions = isReadyFixedSyntheticIdentity(identity)
    ? FIXED_ACCOUNT_ALLOWED_SESSION_ACTIONS
    : ALLOWED_SESSION_ACTIONS
  if (!allowedActions.has(action))
    throw new SyntheticAccountError('synthetic_action_forbidden', '测试身份不允许执行该账户操作。')
}

async function guardSyntheticSessionAction(db, uid, action) {
  const classification = await classifyAccountIdentity(db, uid)
  if (classification.synthetic)
    assertSyntheticSessionAction(action, classification.identity)
  return classification
}

async function handlePrepareSyntheticBaseline(db, event, options = {}) {
  const expectedToken = options.expectedToken ?? process.env.TEST_BROKER_ACCOUNT_API_TOKEN ?? ''
  if (!isSecureServiceToken(expectedToken))
    throw new SyntheticAccountError('synthetic_baseline_not_configured', '测试身份钱包基线服务未配置', 503)
  if (!timingSafeTokenMatch(event?.serviceToken, expectedToken))
    throw new SyntheticAccountError('synthetic_baseline_forbidden', '测试身份钱包基线鉴权失败')

  const input = normalizeBaselinePreparation(event, options.now ?? Date.now())
  const walletResult = await db.collection(WALLET_COLLECTION).where({ userId: input.userId }).limit(2).get()
  assertDatabaseResult(walletResult)
  if (!Array.isArray(walletResult?.data) || walletResult.data.length > 1)
    throw new SyntheticAccountError('synthetic_wallet_invalid', '测试身份钱包不存在唯一映射')
  const knownWallet = walletResult.data[0] || null
  if (knownWallet && (!knownWallet._id
    || knownWallet.userId !== input.userId
    || !Number.isSafeInteger(knownWallet.balance)
    || knownWallet.balance < 0
    || !Number.isSafeInteger(knownWallet.version)
    || knownWallet.version < 0)) {
    throw new SyntheticAccountError('synthetic_wallet_invalid', '测试身份钱包状态无效')
  }

  const walletId = knownWallet?._id || stableId('user_wallet', input.userId)
  const refId = `synthetic-baseline:${input.identityId}:v${input.identityVersion}`
  const transactionId = stableId('synthetic_baseline_transaction', input.identityId, input.identityVersion)
  let outcome
  await db.runTransaction(async (transaction) => {
    const identity = await readRequired(transaction, 'test_identities', input.identityId)
    assertBaselineIdentity(identity, input)
    const baseline = identity.baseline.coin
    const transactionRef = transaction.collection(COIN_TX_COLLECTION).doc(transactionId)
    const walletRef = transaction.collection(WALLET_COLLECTION).doc(walletId)
    const wallet = await readRef(walletRef)
    if (wallet && (wallet.userId !== input.userId
      || !Number.isSafeInteger(wallet.balance)
      || wallet.balance < 0
      || !Number.isSafeInteger(wallet.version)
      || wallet.version < 0)) {
      throw new SyntheticAccountError('synthetic_wallet_invalid', '测试身份钱包状态无效')
    }
    const existingTransaction = await readRef(transactionRef)
    if (existingTransaction) {
      assertExistingBaselineTransaction(existingTransaction, input, baseline, refId, transactionId)
      if (!wallet || wallet.balance !== baseline)
        throw new SyntheticAccountError('synthetic_baseline_conflict', '测试身份钱包与基线幂等记录冲突')
      outcome = { balance: baseline, deduped: true, transactionId }
      return
    }
    const currentBalance = wallet?.balance || 0
    const amount = baseline - currentBalance
    if (amount === 0) {
      if (!wallet) {
        await setRef(walletRef, {
          userId: input.userId,
          balance: baseline,
          version: 1,
          createdAt: input.now,
          updatedAt: input.now,
        })
      }
      outcome = { balance: baseline, deduped: Boolean(wallet) }
      return
    }

    const nextWallet = {
      userId: input.userId,
      balance: baseline,
      version: wallet ? wallet.version + 1 : 1,
      ...(wallet ? {} : { createdAt: input.now }),
      updatedAt: input.now,
    }
    if (wallet)
      await updateRef(walletRef, nextWallet)
    else
      await setRef(walletRef, nextWallet)
    await setRef(transactionRef, {
      userId: input.userId,
      appId: 'admin-test-broker',
      type: amount > 0 ? 'gift' : 'consume',
      amount,
      balanceAfter: baseline,
      refId,
      meta: {
        synthetic: true,
        syntheticBaseline: true,
        syntheticIdentityId: input.identityId,
        syntheticIdentityVersion: input.identityVersion,
      },
      createdAt: input.now,
    })
    outcome = { balance: baseline, deduped: false, transactionId }
  })
  if (!outcome)
    throw new SyntheticAccountError('synthetic_baseline_unavailable', '测试身份钱包基线事务无结果', 503)
  return outcome
}

function normalizeBaselinePreparation(event, now) {
  if (!event || typeof event !== 'object'
    || typeof event.identityId !== 'string'
    || !/^[\w:-]{4,128}$/.test(event.identityId)
    || typeof event.userId !== 'string'
    || !/^[\w:-]{1,128}$/.test(event.userId)
    || !Number.isSafeInteger(event.identityVersion)
    || event.identityVersion < 1) {
    throw new SyntheticAccountError('synthetic_baseline_input_invalid', '测试身份钱包基线参数无效')
  }
  return {
    identityId: event.identityId,
    identityVersion: event.identityVersion,
    userId: event.userId,
    now,
  }
}

function assertBaselineIdentity(identity, input) {
  if (identity._id !== input.identityId
    || identity.uid !== input.userId
    || identity.synthetic !== true
    || identity.source !== 'managed'
    || !['disabled', 'quarantined'].includes(identity.status)
    || identity.activeLeaseId !== undefined
    || identity.activeLeaseExpiresAt !== undefined
    || identity.version !== input.identityVersion
    || !Number.isSafeInteger(identity.baseline?.coin)
    || identity.baseline.coin < 0
    || identity.baseline.coin > SYNTHETIC_BASELINE_COIN_MAX) {
    throw new SyntheticAccountError('synthetic_baseline_forbidden', '测试身份当前不能准备钱包基线')
  }
}

function assertExistingBaselineTransaction(transaction, input, baseline, refId, transactionId) {
  const meta = transaction.meta || {}
  const validAmount = Number.isSafeInteger(transaction.amount) && transaction.amount !== 0
  const validType = transaction.amount > 0
    ? transaction.type === 'gift'
    : transaction.type === 'consume'
  if (transaction._id !== transactionId
    || transaction.userId !== input.userId
    || transaction.appId !== 'admin-test-broker'
    || transaction.refId !== refId
    || transaction.balanceAfter !== baseline
    || !validAmount
    || !validType
    || meta.synthetic !== true
    || meta.syntheticBaseline !== true
    || meta.syntheticIdentityId !== input.identityId
    || meta.syntheticIdentityVersion !== input.identityVersion) {
    throw new SyntheticAccountError('synthetic_baseline_conflict', '测试身份钱包基线幂等记录冲突')
  }
}

function documentFromResult(result) {
  if (!result)
    return null
  if (Array.isArray(result.data))
    return result.data[0] || null
  return result.data && typeof result.data === 'object' ? result.data : null
}

async function readRef(ref) {
  const result = await ref.get()
  assertDatabaseResult(result)
  return documentFromResult(result)
}

async function readRequired(database, collection, id) {
  const value = await readRef(database.collection(collection).doc(id))
  if (!value)
    throw new SyntheticAccountError('broker_record_missing', `${collection} record is missing`)
  return value
}

async function updateRef(ref, value) {
  const result = await ref.update(value)
  assertDatabaseResult(result)
  const updated = result?.updated ?? result?.modifiedCount
  if (updated !== undefined && Number(updated) <= 0)
    throw new SyntheticAccountError('broker_state_conflict', 'Database update did not apply', 503)
}

async function setRef(ref, value) {
  const result = await ref.set(value)
  assertDatabaseResult(result)
}

function assertDatabaseResult(result) {
  if (!result?.code)
    return
  const error = new SyntheticAccountError('synthetic_billing_unavailable', result.message || 'Database operation failed', 503)
  error.databaseCode = result.code
  throw error
}

module.exports = {
  ALLOWED_SESSION_ACTIONS,
  FIXED_ACCOUNT_ALLOWED_SESSION_ACTIONS,
  SyntheticAccountError,
  assertSyntheticSessionAction,
  classifyAccountIdentity,
  fixedSyntheticTransactionMeta,
  guardSyntheticSessionAction,
  handlePrepareSyntheticBaseline,
  isReadyFixedSyntheticIdentity,
  isSecureServiceToken,
}
