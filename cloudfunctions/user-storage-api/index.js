/**
 * 云函数 user-storage-api —— YunLeFun 通用用户云空间状态机。
 *
 * 只处理账号级 shared storage quota / reservation / file lifecycle / app-kind policy。
 * 不解析接入应用的业务文件内容，也不承载 account/profile/wallet 行为。
 */

'use strict'

const cloudbase = require('@cloudbase/node-sdk')

const {
  deleteStorageFile,
  finalizeStorageUpload,
  getStorageQuota,
  listStorageFiles,
  readCloudbaseFileInfo,
  reserveStorageUpload,
} = require('./storage')

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
const db = app.database()

const ANON_UIDS = new Set(['', 'anon'])

function getCallerUid(cloudbaseApp = app) {
  try {
    const auth = cloudbaseApp.auth()
    const info = auth.getUserInfo()
    const uid = info?.uid || ''
    return ANON_UIDS.has(uid) ? '' : uid
  }
  catch {
    return ''
  }
}

async function dispatch(event, deps = {}) {
  const payload = event && typeof event === 'object' ? event : {}
  const action = payload.action
  const cloudbaseApp = deps.cloudbaseApp || app
  const database = deps.db || db
  const userId = deps.userId || getCallerUid(cloudbaseApp)
  if (!userId)
    throw new Error('请先登录')

  switch (action) {
    case 'getStorageQuota':
      return await getStorageQuota(database, { userId, now: Date.now() })
    case 'reserveStorageUpload':
      return await reserveStorageUpload(database, { ...payload, userId, now: Date.now() })
    case 'finalizeStorageUpload':
      return await finalizeStorageUpload(
        database,
        { ...payload, userId, now: Date.now() },
        {
          readFileInfo: fileId => readCloudbaseFileInfo(cloudbaseApp, fileId),
          deleteFile: fileId => cloudbaseApp.deleteFile({ fileList: [fileId] }),
        },
      )
    case 'listStorageFiles':
      return await listStorageFiles(database, {
        userId,
        appId: payload.appId,
        kind: payload.kind,
        slotKey: payload.slotKey,
        skip: payload.skip,
        limit: payload.limit,
        includeDeleted: payload.includeDeleted,
      })
    case 'deleteStorageFile':
      return await deleteStorageFile(
        database,
        { ...payload, userId, now: Date.now() },
        { deleteFile: fileId => cloudbaseApp.deleteFile({ fileList: [fileId] }) },
      )
    default:
      throw new Error(`未知 action: ${action}`)
  }
}

exports.main = async (event) => {
  try {
    return await dispatch(event)
  }
  catch (err) {
    console.error('[user-storage-api] 处理失败:', event?.action, err.message)
    throw err
  }
}

exports._private = {
  ANON_UIDS,
  dispatch,
  getCallerUid,
}
