/** Authenticated action router for user-storage-api. */

'use strict'

const process = require('node:process')
const { assertActiveAccountForUid } = require('./account-access')
const { createPrivateCosStorage } = require('./cos-storage')
const {
  WEB_RESUME_APP_ID,
  WEB_RESUME_KIND,
  assertWebResumeDelegation,
  assertWebResumeFileScope,
  assertWebResumeSweeper,
} = require('./internal')
const {
  deleteStorageFile,
  downloadStorageFile,
  finalizeStorageUpload,
  getStorageQuota,
  listStorageFiles,
  reserveStorageUpload,
  STORAGE_FILE_STATUS,
} = require('./storage')
const { sweepWebResumeTrash } = require('./web-resume-trash')

const ANON_UIDS = new Set(['', 'anon'])

function makePrivateStorageResolver(deps = {}) {
  let privateStorage = deps.privateStorage || null
  return () => {
    if (!privateStorage)
      privateStorage = createPrivateCosStorage()
    return privateStorage
  }
}

function getCallerUid(cloudbaseApp) {
  try {
    const auth = cloudbaseApp?.auth()
    const info = auth?.getUserInfo()
    const uid = info?.uid || ''
    return ANON_UIDS.has(uid) ? '' : uid
  }
  catch {
    return ''
  }
}

async function dispatch(event, deps = {}) {
  let payload = event && typeof event === 'object' ? event : {}
  let action = payload.action
  const database = deps.db
  let userId = deps.userId || getCallerUid(deps.cloudbaseApp)
  let delegatedWebResume = false
  const getPrivateStorage = makePrivateStorageResolver(deps)
  if (action === 'sweepWebResumeTrash') {
    assertWebResumeSweeper(payload, deps.webResumeSweeperToken)
    return await sweepWebResumeTrash(database, payload, {
      deleteFile: storageKey => getPrivateStorage().deleteObject(storageKey),
    })
  }
  if (action === 'invokeForWebResume') {
    const delegated = assertWebResumeDelegation(payload, deps.webResumeStorageToken)
    action = delegated.operation
    payload = delegated.payload
    userId = delegated.userId
    delegatedWebResume = true
  }
  if (!database)
    throw new Error('数据库能力不可用')
  if (!userId)
    throw new Error('请先登录')
  await assertActiveAccountForUid(deps.callAccountApi, {
    serviceToken: deps.serviceToken ?? process.env.ACCOUNT_API_INTERNAL_TOKEN ?? '',
    userId,
  })

  switch (action) {
    case 'getStorageQuota':
      return await getStorageQuota(database, { userId, now: Date.now() })
    case 'reserveStorageUpload': {
      const input = delegatedWebResume
        ? {
            ...payload,
            appId: WEB_RESUME_APP_ID,
            contentType: 'application/yaml',
            kind: WEB_RESUME_KIND,
          }
        : payload
      const reserved = await reserveStorageUpload(database, { ...input, userId, now: Date.now() })
      if (reserved.file.status !== STORAGE_FILE_STATUS.RESERVED)
        return reserved
      const upload = await getPrivateStorage().createUploadUrl(
        reserved.file.storageKey,
        reserved.file.contentType,
      )
      return { ...reserved, upload }
    }
    case 'finalizeStorageUpload':
      if (delegatedWebResume)
        await assertWebResumeFileScope(database, userId, payload.reservationId)
      return await finalizeStorageUpload(
        database,
        { ...payload, userId, now: Date.now() },
        {
          downloadFile: storageKey => getPrivateStorage().getObject(storageKey),
          readFileInfo: storageKey => getPrivateStorage().headObject(storageKey),
          deleteFile: storageKey => getPrivateStorage().deleteObject(storageKey),
          describeObject: storageKey => getPrivateStorage().describeObject(storageKey),
        },
      )
    case 'listStorageFiles':
      return await listStorageFiles(database, {
        userId,
        appId: delegatedWebResume ? WEB_RESUME_APP_ID : payload.appId,
        kind: delegatedWebResume ? WEB_RESUME_KIND : payload.kind,
        slotKey: payload.slotKey,
        skip: payload.skip,
        limit: payload.limit,
        includeDeleted: payload.includeDeleted,
      })
    case 'deleteStorageFile':
      if (delegatedWebResume)
        await assertWebResumeFileScope(database, userId, payload.reservationId)
      return await deleteStorageFile(
        database,
        { ...payload, userId, now: Date.now() },
        { deleteFile: storageKey => getPrivateStorage().deleteObject(storageKey) },
      )
    case 'downloadStorageFile':
      if (delegatedWebResume)
        await assertWebResumeFileScope(database, userId, payload.reservationId)
      return await downloadStorageFile(
        database,
        { ...payload, userId, now: Date.now() },
        {
          downloadFile: storageKey => getPrivateStorage().getObject(storageKey),
          createDownloadUrl: storageKey => getPrivateStorage().createDownloadUrl(storageKey),
        },
      )
    default:
      throw new Error(`未知 action: ${action}`)
  }
}

module.exports = {
  ANON_UIDS,
  dispatch,
  getCallerUid,
  makePrivateStorageResolver,
}
