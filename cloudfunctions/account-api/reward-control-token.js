'use strict'

const { Buffer } = require('node:buffer')
const crypto = require('node:crypto')
const process = require('node:process')

const REWARD_CONTROL_ACTIONS = new Set([
  'getRewardCapabilities',
  'adminGrantReward',
  'adminCorrectReward',
])

function decodeToken(raw) {
  if (typeof raw !== 'string' || !/^[a-z0-9+/]{43}=$/i.test(raw))
    throw new Error('奖励控制面 token 配置无效')
  const token = Buffer.from(raw, 'base64')
  if (token.length !== 32 || token.toString('base64') !== raw)
    throw new Error('奖励控制面 token 配置无效')
  return token
}

function parseRewardControlTokens(raw = process.env.REWARD_CONTROL_TOKENS || '') {
  let value
  try {
    value = JSON.parse(raw)
  }
  catch {
    throw new Error('奖励控制面 tokens 配置无效')
  }
  const entries = value && typeof value === 'object' && !Array.isArray(value)
    ? Object.entries(value)
    : []
  if (entries.length < 1 || entries.length > 2)
    throw new Error('奖励控制面仅允许配置 current/previous 两枚 token')
  return entries.map(([name, token]) => {
    if (!/^(?:current|previous)$/.test(name))
      throw new Error('奖励控制面 token 名称无效')
    return decodeToken(token)
  })
}

function assertRewardControlToken(event, options = {}) {
  if (!REWARD_CONTROL_ACTIONS.has(event?.action))
    throw new Error('奖励控制面 action 不被允许')
  const provided = typeof event?.rewardControlToken === 'string'
    ? Buffer.from(event.rewardControlToken, 'base64')
    : Buffer.alloc(0)
  const tokens = options.tokens || parseRewardControlTokens()
  const valid = tokens.some(token =>
    token.length === provided.length && crypto.timingSafeEqual(token, provided),
  )
  if (!valid)
    throw new Error('奖励控制面鉴权失败')
}

module.exports = {
  assertRewardControlToken,
  parseRewardControlTokens,
}
