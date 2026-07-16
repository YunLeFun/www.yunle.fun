/** Synthetic identity mutation guard and trusted wallet settlement. */

'use strict'

const { Buffer } = require('node:buffer')
const crypto = require('node:crypto')
const process = require('node:process')

const { COIN_TX_COLLECTION, WALLET_COLLECTION } = require('./lib/wallet')

const ALLOWED_SESSION_ACTIONS = new Set(['getAccount', 'listTransactions'])
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

function syntheticReservationId(leaseId, bizId) {
  return `sir_${stableId('synthetic_ai_reservation', leaseId, bizId)}`
}

function syntheticCoinTransactionId(userId, bizId) {
  return stableId('coin_transaction', userId, 'consume', bizId)
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

function assertSyntheticSessionAction(action) {
  if (!ALLOWED_SESSION_ACTIONS.has(action))
    throw new SyntheticAccountError('synthetic_action_forbidden', '测试身份不允许执行该账户操作。')
}

async function guardSyntheticSessionAction(db, uid, action) {
  const classification = await classifyAccountIdentity(db, uid)
  if (classification.synthetic)
    assertSyntheticSessionAction(action)
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
      outcome = { balance: baseline, deduped: true }
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

async function handleSyntheticDeductCoinForUser(db, event, options = {}) {
  const expectedToken = options.expectedToken ?? process.env.AI_GATEWAY_ACCOUNT_API_TOKEN ?? ''
  if (!isSecureServiceToken(expectedToken))
    throw new SyntheticAccountError('synthetic_billing_not_configured', 'AI Gateway 内部鉴权未配置', 503)
  if (!timingSafeTokenMatch(event?.serviceToken, expectedToken))
    throw new SyntheticAccountError('synthetic_billing_forbidden', 'AI Gateway 内部鉴权失败')

  const input = normalizeSyntheticDeduct(event, options.now ?? Date.now())
  const classification = await classifyAccountIdentity(db, input.userId)
  if (!classification.synthetic || classification.identity._id === '')
    throw new SyntheticAccountError('synthetic_identity_required', '该扣费接口仅用于测试身份')

  const walletResult = await db.collection(WALLET_COLLECTION).where({ userId: input.userId }).limit(2).get()
  if (!walletResult || !Array.isArray(walletResult.data) || walletResult.data.length !== 1)
    throw new SyntheticAccountError('synthetic_wallet_invalid', '测试身份钱包不存在或不唯一')
  const knownWallet = walletResult.data[0]
  if (typeof knownWallet._id !== 'string' || !knownWallet._id)
    throw new SyntheticAccountError('synthetic_wallet_invalid', '测试身份钱包缺少文档 ID')

  const transactionId = syntheticCoinTransactionId(input.userId, input.bizId)
  let outcome
  await db.runTransaction(async (transaction) => {
    const reservation = await readRequired(transaction, 'test_identity_coin_reservations', input.reservationId)
    assertReservationBinding(reservation, input, classification.identity._id)
    const transactionRef = transaction.collection(COIN_TX_COLLECTION).doc(transactionId)
    const existingTransaction = await readRef(transactionRef)
    if (existingTransaction) {
      assertExistingTransaction(existingTransaction, input, transactionId)
      outcome = { balance: existingTransaction.balanceAfter, deduped: true, transactionId }
      return
    }

    assertReservationSettleable(reservation)

    const [lease, identity] = await Promise.all([
      readRequired(transaction, 'test_identity_leases', input.syntheticLeaseId),
      readRequired(transaction, 'test_identities', classification.identity._id),
    ])
    assertActiveBindings(identity, lease, reservation, input)
    const walletRef = transaction.collection(WALLET_COLLECTION).doc(knownWallet._id)
    const wallet = await readRef(walletRef)
    if (!wallet
      || wallet.userId !== input.userId
      || !Number.isInteger(wallet.balance)
      || wallet.balance < input.amount
      || !Number.isInteger(wallet.version)
      || wallet.version < 0) {
      throw new SyntheticAccountError('synthetic_wallet_invalid', '测试身份钱包余额或版本无效')
    }

    const balance = wallet.balance - input.amount
    await updateRef(walletRef, {
      balance,
      version: wallet.version + 1,
      updatedAt: input.now,
    })
    await setRef(transactionRef, {
      userId: input.userId,
      appId: input.appId,
      type: 'consume',
      amount: -input.amount,
      balanceAfter: balance,
      refId: input.bizId,
      meta: {
        kind: 'aiChat',
        synthetic: true,
        syntheticLeaseId: input.syntheticLeaseId,
        syntheticReservationId: input.reservationId,
        syntheticScopeId: input.syntheticScopeId,
      },
      createdAt: input.now,
    })
    await updateDocument(transaction, 'test_identity_coin_reservations', input.reservationId, {
      billingStatus: 'charged',
      coinTransactionId: transactionId,
      billingCommittedAt: input.now,
      updatedAt: input.now,
    })
    outcome = { balance, deduped: false, transactionId }
  })

  if (!outcome)
    throw new SyntheticAccountError('synthetic_billing_unavailable', 'Synthetic billing transaction returned no result', 503)
  return outcome
}

function normalizeSyntheticDeduct(event, now) {
  if (!event || typeof event !== 'object')
    throw new SyntheticAccountError('synthetic_billing_input_invalid', '扣费参数无效')
  const fields = ['userId', 'appId', 'bizId', 'reservationId', 'syntheticLeaseId', 'syntheticScopeId']
  for (const field of fields) {
    if (typeof event[field] !== 'string' || !/^[\w:-]{1,128}$/.test(event[field]))
      throw new SyntheticAccountError('synthetic_billing_input_invalid', `${field} 无效`)
  }
  if (!Number.isInteger(event.amount) || event.amount <= 0)
    throw new SyntheticAccountError('synthetic_billing_input_invalid', 'amount 必须为正整数')
  if (event.appId !== 'everything-generator' || event.syntheticScopeId !== 'wish')
    throw new SyntheticAccountError('synthetic_billing_forbidden', '计费应用或 scope 不受信')
  if (!/^wish:[\w-]+:(?:audit|finalize)$/.test(event.bizId))
    throw new SyntheticAccountError('synthetic_billing_forbidden', 'bizId 不属于允许的测试动作')
  if (event.reservationId !== syntheticReservationId(event.syntheticLeaseId, event.bizId))
    throw new SyntheticAccountError('reservation_binding_invalid', 'reservationId 绑定无效')
  return {
    userId: event.userId,
    appId: event.appId,
    amount: event.amount,
    bizId: event.bizId,
    reservationId: event.reservationId,
    syntheticLeaseId: event.syntheticLeaseId,
    syntheticScopeId: event.syntheticScopeId,
    now,
  }
}

function assertReservationBinding(reservation, input, identityId) {
  const action = input.bizId.endsWith(':audit') ? 'wish:audit' : 'wish:finalize'
  if (reservation._id !== input.reservationId
    || reservation.identityId !== identityId
    || reservation.leaseId !== input.syntheticLeaseId
    || reservation.effectiveUid !== input.userId
    || reservation.billingAppId !== input.appId
    || reservation.scopeId !== input.syntheticScopeId
    || reservation.action !== action
    || reservation.bizId !== input.bizId
    || reservation.amount !== input.amount) {
    throw new SyntheticAccountError('reservation_binding_invalid', '测试预算预留不可结算')
  }
}

function assertReservationSettleable(reservation) {
  if (reservation.generationStatus !== 'succeeded' || reservation.status !== 'reserved')
    throw new SyntheticAccountError('reservation_binding_invalid', '测试预算预留不可结算')
}

function assertActiveBindings(identity, lease, reservation, input) {
  if (identity.synthetic !== true
    || identity.uid !== input.userId
    || identity.status !== 'leased'
    || identity.activeLeaseId !== lease._id
    || lease._id !== input.syntheticLeaseId
    || lease.identityId !== identity._id
    || lease.effectiveUid !== input.userId
    || lease.status !== 'active'
    || !Number.isSafeInteger(lease.expiresAt)
    || lease.expiresAt <= input.now
    || !Number.isSafeInteger(identity.version)
    || identity.version < 1
    || !Number.isSafeInteger(lease.policySnapshot?.identityVersion)
    || lease.policySnapshot.identityVersion < 1) {
    throw new SyntheticAccountError('lease_inactive', '测试租约已结束')
  }
  const target = lease.target || {}
  if (target.serviceAudience !== 'ai-gateway'
    || target.billingAppId !== input.appId
    || !target.scopeIds?.includes(input.syntheticScopeId)
    || !target.allowedActions?.includes(reservation.action)) {
    throw new SyntheticAccountError('synthetic_billing_forbidden', '租约目标不允许本次结算')
  }
}

function assertExistingTransaction(transaction, input, transactionId) {
  const meta = transaction.meta || {}
  if (transaction._id !== transactionId
    || transaction.userId !== input.userId
    || transaction.appId !== input.appId
    || transaction.type !== 'consume'
    || transaction.amount !== -input.amount
    || transaction.refId !== input.bizId
    || meta.synthetic !== true
    || meta.syntheticLeaseId !== input.syntheticLeaseId
    || meta.syntheticReservationId !== input.reservationId
    || meta.syntheticScopeId !== input.syntheticScopeId) {
    throw new SyntheticAccountError('synthetic_transaction_conflict', 'Synthetic transaction idempotency conflict')
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

async function updateDocument(database, collection, id, value) {
  return updateRef(database.collection(collection).doc(id), value)
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
  SyntheticAccountError,
  assertSyntheticSessionAction,
  classifyAccountIdentity,
  guardSyntheticSessionAction,
  handlePrepareSyntheticBaseline,
  handleSyntheticDeductCoinForUser,
  isSecureServiceToken,
  syntheticCoinTransactionId,
  syntheticReservationId,
}
