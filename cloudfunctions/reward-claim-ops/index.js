/** Private one-minute reward-claim reconciliation, expiry and ops-alert worker. */

'use strict'

const crypto = require('node:crypto')
const process = require('node:process')
const cloudbase = require('@cloudbase/node-sdk')

const { formatRewardClaimAlert, runRewardClaimOps } = require('./ops')
const { createRewardClaimOpsStore } = require('./store')

function requiredEnv(name) {
  const value = process.env[name]
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${name} 未配置`)
  return value.trim()
}

function createAccountApi(app) {
  const serviceToken = requiredEnv('ACCOUNT_API_INTERNAL_TOKEN')
  return async () => {
    const response = await app.callFunction({
      name: 'account-api',
      data: {
        action: 'adminSweepRewardClaimCampaigns',
        serviceToken,
      },
    })
    const result = response?.result
    if (!result || !Number.isSafeInteger(result.expired) || !Number.isSafeInteger(result.reconciled))
      throw new Error(result?.message || result?.errorMessage || 'account-api 巡检未返回有效结果')
    return result
  }
}

function createWebhookNotifier() {
  const webhookUrl = requiredEnv('REWARD_CLAIM_OPS_WEBHOOK_URL')
  const adminUrl = process.env.REWARD_CLAIM_ADMIN_URL || 'https://admin.yunle.fun/reward-claims'
  return async (alert) => {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        msg_type: 'text',
        content: {
          text: formatRewardClaimAlert(alert, adminUrl),
        },
      }),
    })
    const body = await response.json().catch(() => null)
    if (!response.ok || Number(body?.code) !== 0)
      throw new Error(body?.msg || `运营告警投递失败 (${response.status})`)
  }
}

exports.main = async function main() {
  const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
  const now = Date.now()
  const result = await runRewardClaimOps({
    sweep: createAccountApi(app),
    store: createRewardClaimOpsStore(app.database()),
    notify: createWebhookNotifier(),
    now,
    workerId: `reward-claim-ops:${crypto.randomUUID()}`,
  })
  console.warn('[reward-claim-ops] completed', JSON.stringify(result))
  return result
}

exports._private = {
  createAccountApi,
  createWebhookNotifier,
  requiredEnv,
}
