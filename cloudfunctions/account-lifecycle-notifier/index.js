/** 每 5 分钟发送账号生命周期事务邮件。 */

'use strict'

const process = require('node:process')
const cloudbase = require('@cloudbase/node-sdk')

const { loadEmailConfig } = require('./config')
const { getTencentEmailStatus, sendTencentEmail } = require('./delivery')
const { processNotificationJob } = require('./queue')
const { createRecipientResolver } = require('./recipient')
const {
  createNotificationStore,
  runDeliveryStatusSweep,
  runNotificationSweep,
} = require('./sweep')

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

function createSesClient(config, context = {}) {
  const tencentcloud = require('tencentcloud-sdk-nodejs-ses')
  const Client = tencentcloud.ses.v20201002.Client
  const credential = {
    secretId: context.TENCENTCLOUD_SECRETID || process.env.TENCENTCLOUD_SECRETID,
    secretKey: context.TENCENTCLOUD_SECRETKEY || process.env.TENCENTCLOUD_SECRETKEY,
    token: context.TENCENTCLOUD_SESSIONTOKEN || process.env.TENCENTCLOUD_SESSIONTOKEN,
  }
  if (!credential.secretId || !credential.secretKey)
    throw new Error('CloudBase 运行时临时凭证不可用')
  return new Client({
    credential,
    region: config.region,
    profile: {
      httpProfile: {
        endpoint: 'ses.tencentcloudapi.com',
      },
    },
  })
}

exports.main = async function main(_event, context = {}) {
  const runtime = cloudbase.getCloudbaseContext()
  const envId = runtime.TCB_ENV || runtime.SCF_NAMESPACE
  if (!envId)
    throw new Error('无法确定当前 CloudBase 环境')

  const config = loadEmailConfig()
  const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
  const store = createNotificationStore(app.database(), {
    userDailyLimit: config.userDailyLimit,
    opsDailyLimit: config.opsDailyLimit,
  })
  const resolveRecipient = createRecipientResolver(createManager(envId, context))
  const now = Date.now()
  const client = config.mode === 'live' ? createSesClient(config, context) : null
  const delivery = config.mode === 'live'
    ? await runDeliveryStatusSweep({
        store,
        now,
        getStatus: query => getTencentEmailStatus(client, query),
      })
    : {
        checked: 0,
        delivered: 0,
        pending: 0,
        failed: 0,
        alertsQueued: 0,
        errors: 0,
      }
  const notifications = await runNotificationSweep({
    store,
    now,
    mode: config.mode,
    processJob: job => processNotificationJob(job, {
      store,
      send: message => sendTencentEmail(client, config, message),
      resolveRecipient,
      opsEmail: config.opsEmail,
      now,
    }),
  })
  const pruned = config.mode === 'live'
    ? await store.pruneExpired(now)
    : { notifications: 0, contacts: 0 }
  const result = {
    ok: notifications.ok && delivery.errors === 0,
    mode: config.mode,
    notifications,
    delivery,
    pruned,
  }
  console.warn('[account-lifecycle-notifier] completed', JSON.stringify(result))
  return result
}

exports._private = { createManager, createSesClient, loadEmailConfig }
