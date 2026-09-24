/** Authenticated action router for user-storage-api. */

'use strict'

const process = require('node:process')
const { assertActiveAccountForUid } = require('./account-access')
const { createPrivateCosStorage } = require('./cos-storage')
const {
  WEB_RESUME_APP_ID,
  WEB_RESUME_KIND,
  DRIVE_APP_ID,
  DRIVE_ASSET_KIND,
  assertDriveAssetDelegation,
  assertDriveAssetFileScope,
  assertWebResumeDelegation,
  assertWebResumeFileScope,
  assertWebResumeSweeper,
} = require('./internal')
const {
  deleteStorageFile,
  downloadStorageFile,
  findStorageFile,
  finalizeStorageUpload,
  getStorageQuota,
  listStorageFiles,
  reserveStorageUpload,
  STORAGE_FILE_STATUS,
  STORAGE_FILE_KIND,
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

function makeAssetStorageResolver(deps = {}) {
  let assetStorage = deps.assetStorage || null
  return () => {
    if (!assetStorage) {
      const bucket = String(process.env.ASSET_PRIVATE_COS_BUCKET || '').trim()
      if (!bucket || bucket === process.env.PRIVATE_COS_BUCKET || bucket.startsWith('7975-'))
        throw new Error('素材独立私有 COS Bucket 未配置')
      assetStorage = createPrivateCosStorage({ bucket })
    }
    return assetStorage
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
  let delegatedDriveAsset = false
  const getPrivateStorage = makePrivateStorageResolver(deps)
  const getAssetStorage = makeAssetStorageResolver(deps)
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
  if (action === 'invokeForDriveAsset') {
    const delegated = assertDriveAssetDelegation(payload, deps.driveStorageToken)
    action = delegated.operation
    payload = delegated.payload
    userId = delegated.userId
    delegatedDriveAsset = true
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
      if (!delegatedDriveAsset && payload.kind === STORAGE_FILE_KIND.ASSET)
        throw new Error('素材原图只能通过 Drive 服务端预留')
      const input = delegatedWebResume
        ? {
            ...payload,
            appId: WEB_RESUME_APP_ID,
            contentType: 'application/yaml',
            kind: WEB_RESUME_KIND,
          }
        : delegatedDriveAsset
          ? { ...payload, appId: DRIVE_APP_ID, kind: DRIVE_ASSET_KIND, slotKey: '' }
          : payload
      const reserved = await reserveStorageUpload(database, { ...input, userId, now: Date.now() })
      if (!delegatedDriveAsset && !delegatedWebResume && reserved.file.kind === STORAGE_FILE_KIND.ASSET)
        throw new Error('素材原图只能通过 Drive 服务端预留')
      // reservationId is unique per user, not per application. An idempotent
      // retry must never return or sign an existing reservation from another app.
      if (delegatedWebResume && (reserved.file.appId !== WEB_RESUME_APP_ID || reserved.file.kind !== WEB_RESUME_KIND))
        throw new Error('Web Resume 上传预留不属于当前应用')
      if (delegatedDriveAsset && (reserved.file.appId !== DRIVE_APP_ID || reserved.file.kind !== DRIVE_ASSET_KIND))
        throw new Error('Drive 素材上传预留不属于当前应用')
      if (reserved.file.status !== STORAGE_FILE_STATUS.RESERVED)
        return reserved
      const upload = await (delegatedDriveAsset ? getAssetStorage() : getPrivateStorage()).createUploadUrl(
        reserved.file.storageKey,
        reserved.file.contentType,
      )
      return { ...reserved, upload }
    }
    case 'finalizeStorageUpload': {
      if (delegatedWebResume)
        await assertWebResumeFileScope(database, userId, payload.reservationId)
      if (delegatedDriveAsset)
        await assertDriveAssetFileScope(database, userId, payload.reservationId)
      else if ((await findStorageFile(database, { userId, reservationId: payload.reservationId }))?.kind === STORAGE_FILE_KIND.ASSET)
        throw new Error('素材原图只能通过 Drive 服务端确认')
      const getStorage = delegatedDriveAsset ? getAssetStorage : getPrivateStorage
      return await finalizeStorageUpload(
        database,
        { ...payload, userId, now: Date.now() },
        {
          downloadFile: storageKey => getStorage().getObject(storageKey),
          readFileInfo: storageKey => getStorage().headObject(storageKey),
          deleteFile: storageKey => getStorage().deleteObject(storageKey),
          describeObject: storageKey => getStorage().describeObject(storageKey),
          acceptAsset: (storageKey, expected) => getStorage().acceptAsset(storageKey, expected),
        },
      )
    }
    case 'listStorageFiles':
      return await listStorageFiles(database, {
        userId,
        appId: delegatedWebResume ? WEB_RESUME_APP_ID : delegatedDriveAsset ? DRIVE_APP_ID : payload.appId,
        kind: delegatedWebResume ? WEB_RESUME_KIND : delegatedDriveAsset ? DRIVE_ASSET_KIND : payload.kind,
        slotKey: payload.slotKey,
        skip: payload.skip,
        limit: payload.limit,
        includeDeleted: payload.includeDeleted,
      })
    case 'deleteStorageFile': {
      if (delegatedWebResume)
        await assertWebResumeFileScope(database, userId, payload.reservationId)
      if (delegatedDriveAsset)
        await assertDriveAssetFileScope(database, userId, payload.reservationId)
      else if ((await findStorageFile(database, { userId, reservationId: payload.reservationId, fileId: payload.fileId, storageKey: payload.storageKey }))?.kind === STORAGE_FILE_KIND.ASSET)
        throw new Error('素材原图只能通过 Drive 服务端删除')
      return await deleteStorageFile(
        database,
        { ...payload, userId, now: Date.now() },
        { deleteFile: storageKey => (delegatedDriveAsset ? getAssetStorage() : getPrivateStorage()).deleteObject(storageKey) },
      )
    }
    case 'downloadStorageFile': {
      if (delegatedWebResume)
        await assertWebResumeFileScope(database, userId, payload.reservationId)
      if (delegatedDriveAsset)
        await assertDriveAssetFileScope(database, userId, payload.reservationId)
      else if ((await findStorageFile(database, { userId, reservationId: payload.reservationId, fileId: payload.fileId, storageKey: payload.storageKey }))?.kind === STORAGE_FILE_KIND.ASSET)
        throw new Error('素材原图只能通过 Drive 服务端读取')
      const getStorage = delegatedDriveAsset ? getAssetStorage : getPrivateStorage
      return await downloadStorageFile(
        database,
        { ...payload, userId, now: Date.now() },
        {
          downloadFile: storageKey => getStorage().getObject(storageKey),
          createDownloadUrl: (storageKey, disposition) => disposition
            ? getStorage().createDownloadUrl(storageKey, disposition)
            : getStorage().createDownloadUrl(storageKey),
        },
      )
    }
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
