'use strict'

const { Buffer } = require('node:buffer')
const crypto = require('node:crypto')
const process = require('node:process')

const { getAccountSnapshot } = require('./account')
const { assertAppId, assertDeductCoinInput } = require('./lib/validation')
const { creditCoin, deductCoin } = require('./lib/wallet')
const { correctReward, grantReward } = require('./rewards')
const { SyntheticAccountError, classifyAccountIdentity, isSecureServiceToken } = require('./synthetic')

/** 单笔管理员调账的云币绝对值上限（防误操作 / 防滥用的资损护栏） */
const ADMIN_ADJUST_MAX_COIN = 100_000

function getExpectedInternalToken(env = process.env) {
  return env.ACCOUNT_API_INTERNAL_TOKEN || ''
}

/**
 * 常量时间比较两个字符串，避免内部 token 校验的 timing 侧信道。
 * 长度不同直接判负（crypto.timingSafeEqual 要求两侧等长）。
 */
function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string')
    return false
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length)
    return false
  return crypto.timingSafeEqual(ba, bb)
}

function assertInternalServiceToken(serviceToken, expectedToken = getExpectedInternalToken()) {
  if (!expectedToken)
    throw new Error('内部服务鉴权未配置')
  if (!timingSafeEqualStr(serviceToken, expectedToken))
    throw new Error('内部服务鉴权失败')
}

function assertUserId(userId) {
  if (typeof userId !== 'string' || !userId.trim())
    throw new Error('userId 必须为非空字符串')
  return userId.trim()
}

async function handleDeductCoinForUser(targetDb, event, options = {}) {
  assertInternalServiceToken(event?.serviceToken, options.expectedToken)
  const userId = assertUserId(event?.userId)
  const classification = await classifyAccountIdentity(targetDb, userId)
  if (classification.synthetic) {
    throw new SyntheticAccountError(
      'synthetic_action_forbidden',
      '测试身份只能通过带有效预算预留的专用扣费接口结算',
    )
  }
  const { appId, amount, bizId } = assertDeductCoinInput(event)
  if (!bizId)
    throw new Error('bizId 必填')
  const { balance, deduped } = await deductCoin(targetDb, {
    userId,
    appId,
    amount,
    bizId,
    meta: event.meta && typeof event.meta === 'object' ? event.meta : undefined,
    now: options.now || Date.now(),
  })
  return { balance, deduped: !!deduped }
}

/**
 * 内部服务按指定 userId 读取账户全貌（余额 + 会员）。
 *
 * 需 ACCOUNT_API_INTERNAL_TOKEN；只读、不产生流水。与登录态 getAccount 共用
 * getAccountSnapshot，保证两条链路返回结构一致（AccountSnapshot）。
 *
 * @param {object} targetDb
 * @param {object} event 需含 serviceToken + userId
 * @param {object} [options] { expectedToken, now }
 * @returns {Promise<{ coin: number, membership: object }>} 账户全貌（余额 + 会员）
 */
async function handleGetAccountForUser(targetDb, event, options = {}) {
  assertInternalServiceToken(event?.serviceToken, options.expectedToken)
  const userId = assertUserId(event?.userId)
  return getAccountSnapshot(targetDb, userId, options.now || Date.now())
}

async function handleAdminGrantReward(targetDb, event, options = {}) {
  assertInternalServiceToken(event?.serviceToken, options.expectedToken)
  return grantReward(targetDb, { ...event, now: options.now ?? Date.now() })
}

async function handleAdminCorrectReward(targetDb, event, options = {}) {
  assertInternalServiceToken(event?.serviceToken, options.expectedToken)
  return correctReward(targetDb, { ...event, now: options.now ?? Date.now() })
}

/**
 * 校验管理员调账入参。
 *
 * @param {object} input
 * @returns {{ userId: string, appId: string, amount: number, refId: string, reason: string, operator: string }} 归一化后的调账参数
 */
function assertAdminAdjustInput(input) {
  if (!input || typeof input !== 'object')
    throw new Error('参数必须为对象')

  const userId = assertUserId(input.userId)
  // appId 用于分应用对账；管理员调账默认归到 'admin'
  const appId = assertAppId(input.appId || 'admin')

  // amount：有符号整数，正=入账、负=扣减，不允许 0，且受单笔上限约束
  const amount = Math.round(Number(input.amount))
  if (!Number.isInteger(amount) || amount === 0)
    throw new Error('调账数量必须为非 0 整数（正=入账，负=扣减）')
  if (Math.abs(amount) > ADMIN_ADJUST_MAX_COIN)
    throw new Error(`单笔调账不得超过 ${ADMIN_ADJUST_MAX_COIN} 云币`)

  // refId：幂等键 + 审计凭证，必填（建议 admin:<操作号>）
  if (typeof input.refId !== 'string' || !input.refId.trim())
    throw new Error('refId 必填（幂等键 / 审计凭证）')
  const refId = input.refId.trim()

  // reason：审计原因，必填
  if (typeof input.reason !== 'string' || !input.reason.trim())
    throw new Error('reason 必填（调账原因）')
  const reason = input.reason.trim()

  // operator：操作人（后台用户名），用于审计
  const operator = typeof input.operator === 'string' ? input.operator.trim() : ''

  return { userId, appId, amount, refId, reason, operator }
}

/**
 * 管理员人工调账（增/减云币）。
 *
 * 复用 wallet.js 的 creditCoin / deductCoin，沿用同一套乐观锁 + refId 幂等，
 * 绝不绕过版本校验。为保留审计线索：
 *   - 入账走 type='gift'，扣减走 type='consume'（不新增账本类型，避免改动同步 lib）；
 *   - meta 统一打 { adminAdjust: true, reason, operator } 标记，便于对账与后台筛选。
 *
 * 幂等：同一 refId 重复调用只生效一次（credit 按 (userId,refId,'gift') 去重，
 * deduct 按 (userId,refId,'consume') 去重）。
 *
 * @param {object} targetDb
 * @param {object} event 需含 serviceToken + userId + amount(有符号) + refId + reason
 * @param {object} [options] { expectedToken, now }
 * @returns {Promise<{ balance: number, deduped: boolean }>} 调账后余额及是否幂等命中
 */
async function handleAdminAdjustCoin(targetDb, event, options = {}) {
  const userId = assertUserId(event?.userId)
  const expectedToken = options.expectedToken ?? getExpectedInternalToken()
  const expectedCleanupToken = options.expectedCleanupToken ?? process.env.TEST_BROKER_ACCOUNT_API_TOKEN ?? ''
  const tokenMatchesDefault = Boolean(expectedToken)
    && timingSafeEqualStr(event?.serviceToken, expectedToken)
  const tokenMatchesCleanup = isSecureServiceToken(expectedCleanupToken)
    && timingSafeEqualStr(event?.serviceToken, expectedCleanupToken)
  if (!expectedToken && !isSecureServiceToken(expectedCleanupToken))
    throw new Error('内部服务鉴权未配置')
  if (!tokenMatchesDefault && !tokenMatchesCleanup)
    throw new Error('内部服务鉴权失败')

  const classification = await classifyAccountIdentity(targetDb, userId)
  const { appId, amount, refId, reason, operator } = assertAdminAdjustInput(event)
  let syntheticReset = false
  if (classification.synthetic) {
    if (!tokenMatchesCleanup)
      throw new Error('内部服务鉴权失败')
    await assertSyntheticReset(targetDb, { ...event, amount }, classification.identity)
    syntheticReset = true
  }
  else if (!tokenMatchesDefault) {
    throw new Error('内部服务鉴权失败')
  }

  const now = options.now || Date.now()
  const meta = syntheticReset
    ? { adminAdjust: true, reason, operator, syntheticReset: true, syntheticLeaseId: event.syntheticLeaseId }
    : { adminAdjust: true, reason, operator }

  if (amount > 0) {
    const { balance, deduped } = await creditCoin(targetDb, {
      userId,
      appId,
      amount,
      type: 'gift',
      refId,
      meta,
      now,
    })
    return { balance, deduped: !!deduped }
  }

  // amount < 0：扣减（余额不足时 deductCoin 抛错）
  const { balance, deduped } = await deductCoin(targetDb, {
    userId,
    appId,
    amount: -amount,
    bizId: refId,
    meta,
    now,
  })
  return { balance, deduped: !!deduped }
}

async function assertSyntheticReset(targetDb, event, identity) {
  if (typeof event.syntheticLeaseId !== 'string' || !/^[\w:-]{4,128}$/.test(event.syntheticLeaseId))
    throw new SyntheticAccountError('synthetic_reset_invalid', 'syntheticLeaseId 无效')
  if (event.refId !== `synthetic-reset:${event.syntheticLeaseId}:wallet`
    || event.reason !== 'synthetic test identity baseline restore'
    || event.operator !== 'cleanup-sweeper'
    || (event.appId || 'admin') !== 'admin-test-broker') {
    throw new SyntheticAccountError('synthetic_reset_invalid', '测试身份钱包重置参数无效')
  }
  const [leaseResult, walletResult] = await Promise.all([
    targetDb.collection('test_identity_leases').doc(event.syntheticLeaseId).get(),
    targetDb.collection('user_wallet').where({ userId: identity.uid }).limit(2).get(),
  ])
  const lease = Array.isArray(leaseResult?.data) ? leaseResult.data[0] : leaseResult?.data
  if (!lease
    || lease._id !== event.syntheticLeaseId
    || lease.identityId !== identity._id
    || lease.effectiveUid !== identity.uid
    || !['revoking', 'cleaning', 'cleanup_failed'].includes(lease.status)
    || !['cleaning', 'quarantined'].includes(identity.status)) {
    throw new SyntheticAccountError('synthetic_reset_invalid', '测试身份租约不在可清理状态')
  }
  const wallets = walletResult?.data
  const wallet = Array.isArray(wallets) && wallets.length === 1 ? wallets[0] : null
  const baseline = identity?.baseline?.coin
  if (!wallet
    || typeof wallet._id !== 'string'
    || !wallet._id
    || wallet.userId !== identity.uid
    || !Number.isSafeInteger(wallet.balance)
    || wallet.balance < 0
    || !Number.isSafeInteger(wallet.version)
    || wallet.version < 0
    || !Number.isSafeInteger(baseline)
    || baseline < 0
    || event.amount !== baseline - wallet.balance
    || event.amount === 0) {
    throw new SyntheticAccountError('synthetic_reset_invalid', '测试身份钱包基线差额无效')
  }
}

module.exports = {
  ADMIN_ADJUST_MAX_COIN,
  assertInternalServiceToken,
  assertUserId,
  assertAdminAdjustInput,
  handleDeductCoinForUser,
  handleGetAccountForUser,
  handleAdminAdjustCoin,
  handleAdminCorrectReward,
  handleAdminGrantReward,
  assertSyntheticReset,
}
