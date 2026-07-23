/** Environment-only configuration parsing for the lifecycle notifier. */

'use strict'

const process = require('node:process')

const { SES_TEMPLATE_CATALOG } = require('./template-catalog')

function positiveInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

function loadEmailConfig(env = process.env) {
  const templateIds = Object.fromEntries(
    Object.entries(SES_TEMPLATE_CATALOG).map(([type, definition]) => [
      type,
      Number(env[definition.environmentVariable]) || 0,
    ]),
  )
  return {
    mode: env.ACCOUNT_LIFECYCLE_EMAIL_MODE === 'live' ? 'live' : 'dry_run',
    region: env.SES_REGION || 'ap-guangzhou',
    fromAddress: env.SES_FROM_EMAIL || 'account@notify.yunle.fun',
    fromName: env.SES_FROM_NAME || '云乐坊账号安全',
    replyTo: env.SES_REPLY_TO || 'kf@yunle.fun',
    opsEmail: env.SES_OPS_EMAIL || 'security@yunle.fun',
    userDailyLimit: positiveInteger(env.ACCOUNT_LIFECYCLE_DAILY_USER_LIMIT, 45),
    opsDailyLimit: positiveInteger(env.ACCOUNT_LIFECYCLE_DAILY_OPS_LIMIT, 5),
    templateIds,
  }
}

module.exports = { loadEmailConfig, positiveInteger }
