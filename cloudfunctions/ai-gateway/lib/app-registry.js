'use strict'

/**
 * 应用计价 / 模型注册表 —— 服务端权威配置，端用户不能覆盖。
 * 业务 prompt 与结果解析仍由接入应用维护。
 */
const APP_REGISTRY = {
  'ai-sfc': { group: 'custom-deepseek-open', model: 'deepseek-v4-flash', billing: 'coin', cost: 1 },
  'everything-generator': {
    group: 'custom-deepseek-open',
    model: 'deepseek-v4-flash',
    billing: 'coin',
    cost: 1,
    messageLimits: { maxChars: 16_000 },
  },
  'zero-echo-2026': {
    group: 'custom-deepseek-open',
    model: 'deepseek-v4-flash',
    billing: 'daily_quota',
    memberDailyLimit: 27,
    ipRateLimit: { blockMs: 60_000, limit: 6, windowMs: 60_000 },
    signingSecretEnv: 'ZERO_ECHO_APP_SIGNING_SECRET',
    standardDailyLimit: 9,
  },
}

function messageLimitsForApp(appConfig) {
  const maxChars = Number(appConfig?.messageLimits?.maxChars)
  return Number.isInteger(maxChars) && maxChars > 0 ? { maxChars } : undefined
}

module.exports = { APP_REGISTRY, messageLimitsForApp }
