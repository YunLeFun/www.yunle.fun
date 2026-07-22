/** 每 5 分钟发送账号生命周期事务邮件。 */

'use strict'

const process = require('node:process')
const cloudbase = require('@cloudbase/node-sdk')

const { sendCloudflareEmail } = require('./delivery')
const { processNotificationJob } = require('./queue')
const { createRecipientResolver } = require('./recipient')
const { createNotificationStore, runNotificationSweep } = require('./sweep')

function createManager(envId, context = {}) {
  const managerModule = require('@cloudbase/manager-node')
  const CloudBase = managerModule.default || managerModule
  return CloudBase.init({
    envId,
    secretId: context.TENCENTCLOUD_SECRETID || process.env.TENCENTCLOUD_SECRETID,
    secretKey: context.TENCENTCLOUD_SECRETKEY || process.env.TENCENTCLOUD_SECRETKEY,
    token: context.TENCENTCLOUD_SESSIONTOKEN || process.env.TENCENTCLOUD_SESSIONTOKEN,
  })
}

function loadEmailConfig(env = process.env) {
  return {
    accountId: env.CLOUDFLARE_EMAIL_ACCOUNT_ID || '',
    apiToken: env.CLOUDFLARE_EMAIL_API_TOKEN || '',
    fromAddress: env.ACCOUNT_LIFECYCLE_FROM_EMAIL || 'noreply@yunle.fun',
    fromName: env.ACCOUNT_LIFECYCLE_FROM_NAME || '云乐坊',
    replyTo: env.ACCOUNT_LIFECYCLE_REPLY_TO || 'kf@yunle.fun',
    opsEmail: env.ACCOUNT_LIFECYCLE_OPS_EMAIL || '',
  }
}

exports.main = async function main(_event, context = {}) {
  const runtime = cloudbase.getCloudbaseContext()
  const envId = runtime.TCB_ENV || runtime.SCF_NAMESPACE
  if (!envId)
    throw new Error('无法确定当前 CloudBase 环境')

  const config = loadEmailConfig()
  const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
  const store = createNotificationStore(app.database())
  const resolveRecipient = createRecipientResolver(createManager(envId, context))
  const send = message => sendCloudflareEmail(globalThis.fetch, config, message)
  const now = Date.now()
  const result = await runNotificationSweep({
    store,
    now,
    processJob: job => processNotificationJob(job, {
      store,
      send,
      resolveRecipient,
      opsEmail: config.opsEmail,
      now,
    }),
  })
  console.warn('[account-lifecycle-notifier] completed', JSON.stringify(result))
  return result
}

exports._private = { createManager, loadEmailConfig }
