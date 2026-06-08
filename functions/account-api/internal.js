'use strict'

const process = require('node:process')

const { assertAppId, assertDeductCoinInput } = require('./lib/validation')
const { creditCoin, deductCoin } = require('./lib/wallet')

function getExpectedInternalToken(env = process.env) {
  return env.ACCOUNT_API_INTERNAL_TOKEN || ''
}

function assertInternalServiceToken(serviceToken, expectedToken = getExpectedInternalToken()) {
  if (!expectedToken)
    throw new Error('内部服务鉴权未配置')
  if (typeof serviceToken !== 'string' || serviceToken !== expectedToken)
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

  // amount：有符号整数，正=入账、负=扣减，不允许 0
  const amount = Math.round(Number(input.amount))
  if (!Number.isInteger(amount) || amount === 0)
    throw new Error('调账数量必须为非 0 整数（正=入账，负=扣减）')

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
  assertInternalServiceToken(event?.serviceToken, options.expectedToken)
  const { userId, appId, amount, refId, reason, operator } = assertAdminAdjustInput(event)
  const now = options.now || Date.now()
  const meta = { adminAdjust: true, reason, operator }

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

module.exports = {
  assertInternalServiceToken,
  assertUserId,
  assertAdminAdjustInput,
  handleDeductCoinForUser,
  handleAdminAdjustCoin,
}
