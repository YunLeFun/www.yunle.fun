/**
 * 云函数 user-storage-api —— YunLeFun 通用用户云空间状态机。
 *
 * 只处理账号级 shared storage quota / reservation / file lifecycle / app-kind policy。
 * 不解析接入应用的业务文件内容，也不承载 account/profile/wallet 行为。
 */

'use strict'

const cloudbase = require('@cloudbase/node-sdk')
const router = require('./router')

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
const db = app.database()
const callAccountApi = data => app.callFunction({ name: 'account-api', data }).then(r => r.result)

exports.main = async (event) => {
  try {
    return await router.dispatch(event, {
      callAccountApi,
      cloudbaseApp: app,
      db,
    })
  }
  catch (err) {
    console.error('[user-storage-api] 处理失败:', event?.action, err.message)
    throw err
  }
}

exports._private = router
