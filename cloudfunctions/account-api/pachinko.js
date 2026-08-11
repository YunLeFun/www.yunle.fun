'use strict'

const { Buffer } = require('node:buffer')
const crypto = require('node:crypto')
const process = require('node:process')

const { assertAccountActionAllowed } = require('./account-access')
const { creditCoin, deductCoin, findTxByRef, getBalance } = require('./lib/wallet')
const {
  SyntheticAccountError,
  classifyAccountIdentity,
  fixedSyntheticTransactionMeta,
  isReadyFixedSyntheticIdentity,
  isSecureServiceToken,
} = require('./synthetic')

const PACHINKO_APP_ID = 'play'
const PACHINKO_RULESET_ID = 'cloud-coin-machine-v3'
const PACHINKO_RULESET_VERSION = 3
const PACHINKO_MIN_WAGER = 1
const PACHINKO_MAX_WAGER = 100
const PACHINKO_MAX_PAYOUT = 1_000
const PACHINKO_SETTLEMENT_COLLECTION = 'pachinko_wallet_settlements'
const ROUND_ID_PATTERN = /^pch_[a-f0-9]{32}$/
const SEED_COMMITMENT_PATTERN = /^[a-f0-9]{64}$/
const PACHINKO_POCKET_IDS = new Set([
  'far-left-x1',
  'left-x2',
  'left-x3',
  'left-x5',
  'center-x10',
  'right-x5',
  'right-x3',
  'right-x2',
  'far-right-x1',
])
const TARGET_MULTIPLIER_SETS = new Set(['1,2,3', '2,3,5', '2,5,10'])
const REFUND_REASONS = new Set([
  'operator_reconciliation',
  'round_state_corrupt',
  'round_expired',
  'simulation_unavailable',
])

class PachinkoAccountError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'PachinkoAccountError'
    this.code = code
  }
}

function getExpectedPachinkoToken(env = process.env) {
  return env.PLAY_PACHINKO_ACCOUNT_API_TOKEN || ''
}

function timingSafeTokenMatch(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string')
    return false
  const left = Buffer.from(provided)
  const right = Buffer.from(expected)
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

function assertPachinkoServiceToken(serviceToken, expectedToken = getExpectedPachinkoToken()) {
  if (!isSecureServiceToken(expectedToken))
    throw new PachinkoAccountError('pachinko_service_not_configured', '弹珠机云币服务鉴权未配置')
  if (!timingSafeTokenMatch(serviceToken, expectedToken))
    throw new PachinkoAccountError('pachinko_service_forbidden', '弹珠机云币服务鉴权失败')
}

function normalizeBaseInput(event) {
  if (!event || typeof event !== 'object')
    throw new PachinkoAccountError('pachinko_input_invalid', '参数必须为对象')
  const userId = typeof event.userId === 'string' ? event.userId.trim() : ''
  if (!userId)
    throw new PachinkoAccountError('pachinko_user_invalid', 'userId 必须为非空字符串')
  const roundId = typeof event.roundId === 'string' ? event.roundId.trim() : ''
  if (!ROUND_ID_PATTERN.test(roundId))
    throw new PachinkoAccountError('pachinko_round_invalid', 'roundId 格式无效')
  const wager = Number(event.wager)
  if (!Number.isSafeInteger(wager) || wager < PACHINKO_MIN_WAGER || wager > PACHINKO_MAX_WAGER)
    throw new PachinkoAccountError('pachinko_wager_invalid', '单次投入必须为 1 至 100 枚云币')
  if (event.rulesetId !== PACHINKO_RULESET_ID || event.rulesetVersion !== PACHINKO_RULESET_VERSION)
    throw new PachinkoAccountError('pachinko_ruleset_invalid', '弹珠机规则版本无效')
  const seedCommitment = typeof event.seedCommitment === 'string'
    ? event.seedCommitment.toLowerCase()
    : ''
  if (!SEED_COMMITMENT_PATTERN.test(seedCommitment))
    throw new PachinkoAccountError('pachinko_seed_commitment_invalid', '随机种子承诺格式无效')
  return {
    roundId,
    rulesetId: PACHINKO_RULESET_ID,
    rulesetVersion: PACHINKO_RULESET_VERSION,
    seedCommitment,
    userId,
    wager,
  }
}

function normalizeTargets(value) {
  if (!Array.isArray(value) || value.length !== 3)
    throw new PachinkoAccountError('pachinko_targets_invalid', '目标口必须恰好包含三项')
  const pocketIds = new Set()
  const targets = value.map((raw) => {
    const pocketId = typeof raw?.pocketId === 'string' ? raw.pocketId : ''
    const multiplier = Number(raw?.multiplier)
    if (!PACHINKO_POCKET_IDS.has(pocketId)
      || !Number.isSafeInteger(multiplier)
      || ![1, 2, 3, 5, 10].includes(multiplier)
      || pocketIds.has(pocketId)) {
      throw new PachinkoAccountError('pachinko_targets_invalid', '目标口或倍率无效')
    }
    pocketIds.add(pocketId)
    return { pocketId, multiplier }
  })
  const multiplierKey = targets.map(target => target.multiplier).sort((a, b) => a - b).join(',')
  if (!TARGET_MULTIPLIER_SETS.has(multiplierKey))
    throw new PachinkoAccountError('pachinko_targets_invalid', '目标倍率组合无效')
  return targets.sort((left, right) => left.pocketId.localeCompare(right.pocketId))
}

async function classifyAllowedIdentity(targetDb, userId) {
  const classification = await classifyAccountIdentity(targetDb, userId)
  if (classification.synthetic && !isReadyFixedSyntheticIdentity(classification.identity)) {
    throw new SyntheticAccountError(
      'synthetic_action_forbidden',
      '测试身份不允许参与正式弹珠机回合',
    )
  }
  return classification
}

function transactionMeta(input, operation, classification, extra = {}) {
  const meta = {
    coinOperation: operation,
    roundId: input.roundId,
    rulesetId: input.rulesetId,
    rulesetVersion: input.rulesetVersion,
    seedCommitment: input.seedCommitment,
    wager: input.wager,
    ...extra,
  }
  return classification.synthetic
    ? fixedSyntheticTransactionMeta(classification.identity, meta)
    : meta
}

function betRef(roundId) {
  return `play:pachinko:${roundId}:bet`
}

function settlementRef(roundId, kind) {
  return `play:pachinko:${roundId}:${kind === 'payout' ? 'payout' : 'refund'}`
}

async function handleFundPachinkoRoundForUser(targetDb, event, options = {}) {
  assertPachinkoServiceToken(event?.serviceToken, options.expectedToken)
  const input = normalizeBaseInput(event)
  const now = options.now ?? Date.now()
  await assertAccountActionAllowed(targetDb, {
    userId: input.userId,
    action: 'fundPachinkoRoundForUser',
    now,
  })
  const classification = await classifyAllowedIdentity(targetDb, input.userId)
  const refId = betRef(input.roundId)
  const expected = {
    appId: PACHINKO_APP_ID,
    amount: -input.wager,
    meta: transactionMeta(input, 'pachinko_bet', classification),
    refId,
    type: 'consume',
    userId: input.userId,
  }
  const existing = await findTxByRef(targetDb, {
    userId: input.userId,
    refId,
    type: 'consume',
  })
  if (existing)
    return confirmedResult(assertTransactionMatch(existing, expected), true)

  const result = await deductCoin(targetDb, {
    userId: input.userId,
    appId: PACHINKO_APP_ID,
    amount: input.wager,
    bizId: refId,
    meta: expected.meta,
    now,
  })
  const transaction = await requireTransaction(targetDb, expected)
  return {
    balance: result.balance,
    deduped: Boolean(result.deduped),
    ledgerRef: transaction.refId,
  }
}

async function handleGetPachinkoBalanceForUser(targetDb, event, options = {}) {
  assertPachinkoServiceToken(event?.serviceToken, options.expectedToken)
  const userId = typeof event?.userId === 'string' ? event.userId.trim() : ''
  if (!userId)
    throw new PachinkoAccountError('pachinko_user_invalid', 'userId 必须为非空字符串')
  await classifyAllowedIdentity(targetDb, userId)
  return { balance: await getBalance(targetDb, userId) }
}

function normalizeSettlementInput(event) {
  const base = normalizeBaseInput(event)
  const targets = normalizeTargets(event.targets)
  if (event.kind === 'payout') {
    const pocketId = typeof event.pocketId === 'string' ? event.pocketId : ''
    const multiplier = Number(event.multiplier)
    const target = targets.find(candidate => candidate.pocketId === pocketId)
    if (!target || !Number.isSafeInteger(multiplier) || target.multiplier !== multiplier)
      throw new PachinkoAccountError('pachinko_award_invalid', '命中结果与目标口不匹配')
    const payout = base.wager * multiplier
    if (payout < 1 || payout > PACHINKO_MAX_PAYOUT)
      throw new PachinkoAccountError('pachinko_payout_invalid', '返币数量超出规则上限')
    return { ...base, kind: 'payout', multiplier, payout, pocketId, targets }
  }
  if (event.kind === 'refund') {
    const reason = typeof event.reason === 'string' ? event.reason : ''
    if (!REFUND_REASONS.has(reason))
      throw new PachinkoAccountError('pachinko_refund_invalid', '技术补偿原因无效')
    return { ...base, kind: 'refund', payout: base.wager, reason, targets }
  }
  throw new PachinkoAccountError('pachinko_settlement_invalid', '结算类型无效')
}

async function handleSettlePachinkoRoundForUser(targetDb, event, options = {}) {
  assertPachinkoServiceToken(event?.serviceToken, options.expectedToken)
  const input = normalizeSettlementInput(event)
  const now = options.now ?? Date.now()
  const classification = await classifyAllowedIdentity(targetDb, input.userId)
  await requireTransaction(targetDb, {
    appId: PACHINKO_APP_ID,
    amount: -input.wager,
    meta: transactionMeta(input, 'pachinko_bet', classification),
    refId: betRef(input.roundId),
    type: 'consume',
    userId: input.userId,
  })
  const refId = settlementRef(input.roundId, input.kind)
  const extra = input.kind === 'payout'
    ? { kind: input.kind, multiplier: input.multiplier, payout: input.payout, pocketId: input.pocketId, targets: input.targets }
    : { kind: input.kind, payout: input.payout, reason: input.reason, targets: input.targets }
  const meta = transactionMeta(input, 'pachinko_settlement', classification, extra)
  const intent = {
    appId: PACHINKO_APP_ID,
    kind: input.kind,
    meta,
    payout: input.payout,
    refId,
    roundId: input.roundId,
    userId: input.userId,
    wager: input.wager,
  }
  await ensureSettlementIntent(targetDb, intent, now)
  const expected = {
    appId: PACHINKO_APP_ID,
    amount: input.payout,
    meta,
    refId,
    type: input.kind === 'payout' ? 'gift' : 'refund',
    userId: input.userId,
  }
  const existing = await findTxByRef(targetDb, {
    userId: input.userId,
    refId,
    type: expected.type,
  })
  if (existing) {
    const transaction = assertTransactionMatch(existing, expected)
    await confirmSettlementIntent(targetDb, intent, transaction.balanceAfter, now)
    return confirmedResult(transaction, true)
  }

  const result = await creditCoin(targetDb, {
    userId: input.userId,
    appId: PACHINKO_APP_ID,
    amount: input.payout,
    type: expected.type,
    refId,
    meta,
    now,
  })
  const transaction = await requireTransaction(targetDb, expected)
  await confirmSettlementIntent(targetDb, intent, result.balance, now)
  return {
    balance: result.balance,
    deduped: Boolean(result.deduped),
    ledgerRef: transaction.refId,
  }
}

function confirmedResult(transaction, deduped) {
  return {
    balance: transaction.balanceAfter,
    deduped,
    ledgerRef: transaction.refId,
  }
}

async function requireTransaction(targetDb, expected) {
  const transaction = await findTxByRef(targetDb, {
    userId: expected.userId,
    refId: expected.refId,
    type: expected.type,
  })
  if (!transaction)
    throw new PachinkoAccountError('pachinko_ledger_missing', '云币流水确认失败')
  return assertTransactionMatch(transaction, expected)
}

function assertTransactionMatch(transaction, expected) {
  if (transaction.userId !== expected.userId
    || transaction.appId !== expected.appId
    || transaction.type !== expected.type
    || transaction.amount !== expected.amount
    || transaction.refId !== expected.refId
    || !sameJson(transaction.meta, expected.meta)
    || !Number.isSafeInteger(transaction.balanceAfter)
    || transaction.balanceAfter < 0) {
    throw new PachinkoAccountError('pachinko_idempotency_conflict', '弹珠机云币流水幂等参数冲突')
  }
  return transaction
}

function settlementIntentId(roundId) {
  return `pws_${crypto.createHash('sha256').update(roundId).digest('hex').slice(0, 40)}`
}

async function ensureSettlementIntent(targetDb, intent, now) {
  const id = settlementIntentId(intent.roundId)
  await targetDb.runTransaction(async (transaction) => {
    const reference = transaction.collection(PACHINKO_SETTLEMENT_COLLECTION).doc(id)
    const existing = documentFromResult(await reference.get())
    if (existing) {
      assertSettlementIntentMatch(existing, { ...intent, id })
      return
    }
    await reference.set({
      ...intent,
      id,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    })
  })
}

async function confirmSettlementIntent(targetDb, intent, balance, now) {
  const id = settlementIntentId(intent.roundId)
  await targetDb.runTransaction(async (transaction) => {
    const reference = transaction.collection(PACHINKO_SETTLEMENT_COLLECTION).doc(id)
    const existing = documentFromResult(await reference.get())
    if (!existing)
      throw new PachinkoAccountError('pachinko_settlement_missing', '弹珠机结算意图缺失')
    assertSettlementIntentMatch(existing, { ...intent, id })
    if (existing.status === 'confirmed') {
      if (existing.balanceAfter !== balance)
        throw new PachinkoAccountError('pachinko_idempotency_conflict', '弹珠机结算余额冲突')
      return
    }
    await reference.update({
      balanceAfter: balance,
      confirmedAt: now,
      status: 'confirmed',
      updatedAt: now,
    })
  })
}

function assertSettlementIntentMatch(existing, expected) {
  for (const key of ['id', 'appId', 'kind', 'payout', 'refId', 'roundId', 'userId', 'wager']) {
    if (existing[key] !== expected[key])
      throw new PachinkoAccountError('pachinko_settlement_conflict', '同一回合已存在不同的结算意图')
  }
  if (!sameJson(existing.meta, expected.meta))
    throw new PachinkoAccountError('pachinko_settlement_conflict', '同一回合结算内容冲突')
}

function documentFromResult(result) {
  if (!result)
    return null
  if (Array.isArray(result.data))
    return result.data[0] || null
  return result.data && typeof result.data === 'object' ? result.data : null
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

module.exports = {
  PACHINKO_APP_ID,
  PACHINKO_MAX_PAYOUT,
  PACHINKO_MAX_WAGER,
  PACHINKO_MIN_WAGER,
  PACHINKO_RULESET_ID,
  PACHINKO_RULESET_VERSION,
  PACHINKO_SETTLEMENT_COLLECTION,
  PachinkoAccountError,
  assertPachinkoServiceToken,
  betRef,
  getExpectedPachinkoToken,
  handleFundPachinkoRoundForUser,
  handleGetPachinkoBalanceForUser,
  handleSettlePachinkoRoundForUser,
  settlementRef,
}
