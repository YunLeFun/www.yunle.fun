/** 每小时处理已满 30 天冷静期的账号，并删除 CloudBase Auth 身份。 */

'use strict'

const process = require('node:process')
const cloudbase = require('@cloudbase/node-sdk')

const { runAccountMaintenance } = require('./maintenance')
const { createLifecycleNotifier } = require('./notifications')
const { SWEEP_LIMIT, createAuthAdmin, createStore, sweepDueAccountDeletions } = require('./sweep')

function createAccountApi(app) {
  const serviceToken = process.env.ACCOUNT_API_INTERNAL_TOKEN
  if (!serviceToken)
    throw new Error('ACCOUNT_API_INTERNAL_TOKEN 未配置')
  return {
    async finalize(userId) {
      const response = await app.callFunction({
        name: 'account-api',
        data: { action: 'finalizeAccountDeletion', userId, serviceToken },
      })
      return response?.result
    },
    async expireRestrictions() {
      const response = await app.callFunction({
        name: 'account-api',
        data: { action: 'expireAccountRestrictions', serviceToken },
      })
      return response?.result
    },
  }
}

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

exports.main = async function main(_event, context = {}) {
  const runtime = cloudbase.getCloudbaseContext()
  const envId = runtime.TCB_ENV || runtime.SCF_NAMESPACE
  if (!envId)
    throw new Error('无法确定当前 CloudBase 环境')

  const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
  const database = app.database()
  const accountApi = createAccountApi(app)
  const now = Date.now()
  const result = await runAccountMaintenance({
    expireRestrictions: () => accountApi.expireRestrictions(),
    sweepDeletions: () => sweepDueAccountDeletions({
      store: createStore(database),
      accountApi,
      authAdmin: createAuthAdmin(createManager(envId, context)),
      notifier: createLifecycleNotifier(database),
      now,
    }),
  })
  console.warn('[account-deletion-sweeper] completed', JSON.stringify(result))
  return result
}

exports.SWEEP_LIMIT = SWEEP_LIMIT
