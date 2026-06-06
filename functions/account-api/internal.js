'use strict'

const process = require('node:process')

const { assertDeductCoinInput } = require('./lib/validation')
const { deductCoin } = require('./lib/wallet')

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

module.exports = {
  assertInternalServiceToken,
  assertUserId,
  handleDeductCoinForUser,
}
