/**
 * 全局云空间配额与文件索引。
 *
 * 设计目标：
 * - `www.yunle.fun` 作为账号体系内的唯一配额真相源；
 * - 所有应用共享同一个 userId 维度的 quota/used/reserved；
 * - reserve/finalize/delete 均幂等，且不因会员降级删除用户文件。
 */

'use strict'

const { Buffer } = require('node:buffer')
const crypto = require('node:crypto')

const { isMembershipActive } = require('./lib/membership')
const { readMembership } = require('./lib/orders')
const { assertAppId } = require('./lib/validation')

const USER_STORAGE_QUOTAS_COLLECTION = 'user_storage_quotas'
const USER_STORAGE_FILES_COLLECTION = 'user_storage_files'

const MB = 1024 * 1024
const NORMAL_STORAGE_QUOTA_BYTES = 100 * MB
const MEMBER_STORAGE_QUOTA_BYTES = 1024 * MB
const SINGLE_FILE_LIMIT_BYTES = 200 * MB
const BRUSH_LIBRARY_MAX_BYTES = 256 * 1024
const INLINE_DOWNLOAD_MAX_BYTES = 4 * MB
const STORAGE_RESERVATION_TTL_MS = 30 * 60 * 1000
const STORAGE_QUOTA_MAX_RETRY = 5

const STORAGE_FILE_KIND = Object.freeze({
  ASSET: 'asset',
  BRUSH_LIBRARY: 'brush-library',
  PROJECT: 'project',
})

const ASSET_IMAGE_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/svg+xml',
  'image/webp',
])
const ASSET_IMAGE_EXTENSIONS = Object.freeze({
  'image/jpeg': new Set(['jpg', 'jpeg']),
  'image/png': new Set(['png']),
  'image/svg+xml': new Set(['svg']),
  'image/webp': new Set(['webp']),
})

const SAIER_APP_ID = 'saier'
const SAIER_BRUSH_LIBRARY_FILE_NAME = 'brush-library.saier.brushes.json'
const SAIER_BRUSH_LIBRARY_SLOT_KEY = 'default'

const STORAGE_FILE_STATUS = Object.freeze({
  RESERVED: 'reserved',
  FINALIZING: 'finalizing',
  ACTIVE: 'active',
  DELETED: 'deleted',
  EXPIRED: 'expired',
})

function assertUserId(userId) {
  if (typeof userId !== 'string' || !userId.trim())
    throw new Error('userId 必须为非空字符串')
  return userId.trim()
}

function assertReservationId(value) {
  if (typeof value !== 'string' || !/^[\w-]{8,80}$/.test(value))
    throw new Error('reservationId 必须为 8~80 位字母、数字、下划线或短横线')
  return value
}

function makeReservationId() {
  if (typeof crypto.randomUUID === 'function')
    return crypto.randomUUID().replace(/-/g, '')
  return crypto.randomBytes(16).toString('hex')
}

function safeNonNegativeInteger(value, fallback = 0) {
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n < 0)
    return fallback
  return n
}

function isDuplicateDocumentError(err) {
  const message = err && typeof err.message === 'string' ? err.message : String(err || '')
  return /duplicate|already exists|already exist|E11000/i.test(message)
}

function assertByteSize(value, name) {
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new Error(`${name} 必须为正整数 bytes`)
  return n
}

function assertOptionalPositiveInteger(value, name, fallback, max) {
  if (value == null)
    return fallback
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new Error(`${name} 必须为正整数`)
  return Math.min(n, max)
}

function assertOptionalString(value, name, maxLength) {
  if (value == null)
    return ''
  if (typeof value !== 'string')
    throw new Error(`${name} 必须为字符串`)
  const text = value.trim()
  if (text.length > maxLength)
    throw new Error(`${name} 最多 ${maxLength} 个字符`)
  return text
}

function assertOptionalToken(value, name, maxLength = 64) {
  const text = assertOptionalString(value, name, maxLength)
  if (text && !/^[\w-]+$/.test(text))
    throw new Error(`${name} 只能包含字母、数字、下划线或短横线`)
  return text
}

function assertStorageKind(value) {
  const kind = assertOptionalToken(value, 'kind', 64)
  if (!kind)
    return ''
  if (!Object.values(STORAGE_FILE_KIND).includes(kind))
    throw new Error(`不支持的文件类型 kind: ${kind}`)
  return kind
}

function assertStorageSlotKey(value) {
  return assertOptionalToken(value, 'slotKey', 64)
}

function sanitizePathSegment(value, fallback) {
  const raw = String(value || '').trim()
  const cleaned = raw.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 96)
  return cleaned || fallback
}

function normalizeFileName(value) {
  const raw = typeof value === 'string' ? value.trim() : ''
  const withoutControls = Array.from(raw).filter(ch => ch.charCodeAt(0) >= 32).join('')
  const cleaned = withoutControls
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 160)
  return cleaned || 'file'
}

function fileExtension(value) {
  const match = String(value || '').toLowerCase().match(/\.([a-z0-9]{1,12})$/)
  return match?.[1] || ''
}

function makeStorageKey({ userId, appId, reservationId, fileName }) {
  return [
    'user-storage',
    sanitizePathSegment(userId, 'user'),
    sanitizePathSegment(appId, 'app'),
    reservationId,
    normalizeFileName(fileName),
  ].join('/')
}

function resolveStoragePolicy({ appId, contentType, fileName, kind, sizeBytes, slotKey }) {
  if (kind === STORAGE_FILE_KIND.ASSET) {
    if (slotKey)
      throw new Error('asset 文件不支持 slotKey')
    const mediaType = normalizeMediaType(contentType)
    if (!ASSET_IMAGE_CONTENT_TYPES.has(mediaType))
      throw new Error(`asset 不支持 contentType: ${mediaType || '(empty)'}`)
    if (!ASSET_IMAGE_EXTENSIONS[mediaType].has(fileExtension(fileName)))
      throw new Error('asset 文件扩展名与 contentType 不匹配')
    return {
      maxBytes: SINGLE_FILE_LIMIT_BYTES,
      singleton: false,
    }
  }

  if (kind === STORAGE_FILE_KIND.BRUSH_LIBRARY) {
    if (appId !== SAIER_APP_ID)
      throw new Error('brush-library 仅支持 appId=saier')
    if (slotKey !== SAIER_BRUSH_LIBRARY_SLOT_KEY)
      throw new Error(`brush-library slotKey 必须为 ${SAIER_BRUSH_LIBRARY_SLOT_KEY}`)
    if (fileName !== SAIER_BRUSH_LIBRARY_FILE_NAME)
      throw new Error(`brush-library 文件名必须为 ${SAIER_BRUSH_LIBRARY_FILE_NAME}`)
    if (contentType !== 'application/json')
      throw new Error('brush-library contentType 必须为 application/json')
    if (sizeBytes > BRUSH_LIBRARY_MAX_BYTES)
      throw new Error(`brush-library 不能超过 ${BRUSH_LIBRARY_MAX_BYTES} bytes`)
    return {
      maxBytes: BRUSH_LIBRARY_MAX_BYTES,
      singleton: true,
    }
  }

  if (kind === STORAGE_FILE_KIND.PROJECT && appId === SAIER_APP_ID) {
    if (slotKey)
      throw new Error('project 文件不支持 slotKey')
    if (contentType && contentType !== 'application/json')
      throw new Error('project contentType 必须为 application/json')
  }
  else if (slotKey && !kind) {
    throw new Error('slotKey 必须与 kind 一起使用')
  }

  return {
    maxBytes: SINGLE_FILE_LIMIT_BYTES,
    singleton: false,
  }
}

function resolveStoredFilePolicy(file) {
  return resolveStoragePolicy({
    appId: file.appId,
    contentType: file.contentType || '',
    fileName: file.fileName || '',
    kind: file.kind || '',
    sizeBytes: safeNonNegativeInteger(file.reservedSizeBytes || file.sizeBytes),
    slotKey: file.slotKey || '',
  })
}

async function readUserStorageQuota(db, userId) {
  const collection = db.collection(USER_STORAGE_QUOTAS_COLLECTION)
  if (typeof collection.doc === 'function') {
    const byId = await collection.doc(userId).get()
    const doc = firstDoc(byId?.data)
    if (doc && typeof doc === 'object' && (!doc.userId || doc.userId === userId))
      return { ...doc, _id: userId, userId: doc.userId || userId }
  }

  const { data } = await collection
    .where({ userId })
    .limit(10)
    .get()
  if (!Array.isArray(data) || data.length === 0)
    return null

  return data.find(item => item?._id === userId) || data[0]
}

function firstDoc(data) {
  if (Array.isArray(data))
    return data[0] || null
  return data || null
}

async function createUserStorageQuota(db, userId, doc) {
  const collection = db.collection(USER_STORAGE_QUOTAS_COLLECTION)
  const { _id, ...payload } = doc
  if (typeof collection.doc === 'function') {
    const ref = collection.doc(userId)
    if (ref && typeof ref.set === 'function') {
      await ref.set(payload)
      return
    }
  }
  await collection.add({ _id, ...payload })
}

function normalizeQuotaDoc(doc) {
  if (!doc)
    return null
  const baseQuotaBytes = safeNonNegativeInteger(doc.baseQuotaBytes, NORMAL_STORAGE_QUOTA_BYTES)
  const addonQuotaBytes = safeNonNegativeInteger(doc.addonQuotaBytes)
  const bonusQuotaBytes = safeNonNegativeInteger(doc.bonusQuotaBytes)
  const quotaBytes = safeNonNegativeInteger(doc.quotaBytes, baseQuotaBytes + addonQuotaBytes + bonusQuotaBytes)
  const usedBytes = safeNonNegativeInteger(doc.usedBytes)
  const reservedBytes = safeNonNegativeInteger(doc.reservedBytes)
  const version = safeNonNegativeInteger(doc.version)
  return {
    ...doc,
    baseQuotaBytes,
    addonQuotaBytes,
    bonusQuotaBytes,
    quotaBytes,
    usedBytes,
    reservedBytes,
    version,
  }
}

function computeQuotaFields(existing, membership, now) {
  const memberActive = isMembershipActive(membership?.expireAt, now)
  const baseQuotaBytes = memberActive ? MEMBER_STORAGE_QUOTA_BYTES : NORMAL_STORAGE_QUOTA_BYTES
  const addonQuotaBytes = safeNonNegativeInteger(existing?.addonQuotaBytes)
  const bonusQuotaBytes = safeNonNegativeInteger(existing?.bonusQuotaBytes)
  return {
    baseQuotaBytes,
    addonQuotaBytes,
    bonusQuotaBytes,
    quotaBytes: baseQuotaBytes + addonQuotaBytes + bonusQuotaBytes,
    membershipActive: memberActive,
    membershipLevel: membership?.level || membership?.planId || null,
    membershipExpireAt: typeof membership?.expireAt === 'number' ? membership.expireAt : null,
  }
}

function needsQuotaSync(quota, fields) {
  return quota.baseQuotaBytes !== fields.baseQuotaBytes
    || quota.addonQuotaBytes !== fields.addonQuotaBytes
    || quota.bonusQuotaBytes !== fields.bonusQuotaBytes
    || quota.quotaBytes !== fields.quotaBytes
    || quota.membershipActive !== fields.membershipActive
    || quota.membershipLevel !== fields.membershipLevel
    || quota.membershipExpireAt !== fields.membershipExpireAt
}

async function syncUserStorageQuota(db, { userId, now = Date.now() }) {
  const uid = assertUserId(userId)

  for (let attempt = 0; attempt < STORAGE_QUOTA_MAX_RETRY; attempt++) {
    const [existingRaw, membership] = await Promise.all([
      readUserStorageQuota(db, uid),
      readMembership(db, uid),
    ])
    const existing = normalizeQuotaDoc(existingRaw)
    const fields = computeQuotaFields(existing, membership, now)

    if (!existing) {
      try {
        const doc = {
          _id: uid,
          userId: uid,
          ...fields,
          usedBytes: 0,
          reservedBytes: 0,
          version: 1,
          createdAt: now,
          updatedAt: now,
        }
        await createUserStorageQuota(db, uid, doc)
        return normalizeQuotaDoc(doc)
      }
      catch (err) {
        if (isDuplicateDocumentError(err))
          continue
        throw new Error(`初始化云空间配额失败: ${err.message || String(err)}`)
      }
    }

    const normalized = {
      ...existing,
      _id: uid,
      userId: uid,
      usedBytes: safeNonNegativeInteger(existing.usedBytes),
      reservedBytes: safeNonNegativeInteger(existing.reservedBytes),
      ...fields,
    }

    if (existing._id !== uid) {
      try {
        const doc = {
          ...normalized,
          version: 1,
          createdAt: existing.createdAt || now,
          updatedAt: now,
        }
        await createUserStorageQuota(db, uid, doc)
        return normalizeQuotaDoc(doc)
      }
      catch (err) {
        if (isDuplicateDocumentError(err))
          continue
        throw new Error(`迁移云空间配额失败: ${err.message || String(err)}`)
      }
    }

    if (!needsQuotaSync(existing, fields))
      return normalized

    const query = Number.isSafeInteger(existingRaw.version)
      ? { _id: uid, version: existing.version }
      : { _id: uid }
    const result = await db
      .collection(USER_STORAGE_QUOTAS_COLLECTION)
      .where(query)
      .update({
        ...fields,
        usedBytes: normalized.usedBytes,
        reservedBytes: normalized.reservedBytes,
        version: existing.version + 1,
        updatedAt: now,
      })
    const updated = result?.updated ?? result?.modifiedCount ?? 0
    if (updated > 0)
      return normalizeQuotaDoc({ ...normalized, version: existing.version + 1, updatedAt: now })
  }

  const [existingRaw, membership] = await Promise.all([
    readUserStorageQuota(db, uid),
    readMembership(db, uid),
  ])
  const existing = normalizeQuotaDoc(existingRaw)
  if (existing) {
    const fields = computeQuotaFields(existing, membership, now)
    const normalized = {
      ...existing,
      _id: uid,
      userId: uid,
      usedBytes: safeNonNegativeInteger(existing.usedBytes),
      reservedBytes: safeNonNegativeInteger(existing.reservedBytes),
      ...fields,
    }
    if (!needsQuotaSync(existing, fields))
      return normalized
  }

  throw new Error('同步云空间配额并发冲突，请重试')
}

function toQuotaSnapshot(quota) {
  const usedBytes = safeNonNegativeInteger(quota.usedBytes)
  const reservedBytes = safeNonNegativeInteger(quota.reservedBytes)
  const quotaBytes = safeNonNegativeInteger(quota.quotaBytes)
  const availableBytes = Math.max(0, quotaBytes - usedBytes - reservedBytes)
  return {
    userId: quota.userId,
    quotaBytes,
    baseQuotaBytes: safeNonNegativeInteger(quota.baseQuotaBytes),
    addonQuotaBytes: safeNonNegativeInteger(quota.addonQuotaBytes),
    bonusQuotaBytes: safeNonNegativeInteger(quota.bonusQuotaBytes),
    usedBytes,
    reservedBytes,
    availableBytes,
    isOverQuota: usedBytes + reservedBytes > quotaBytes,
    singleFileLimitBytes: SINGLE_FILE_LIMIT_BYTES,
    membership: {
      isActive: !!quota.membershipActive,
      level: quota.membershipLevel || null,
      expireAt: quota.membershipExpireAt || null,
    },
    updatedAt: quota.updatedAt || null,
  }
}

function toFileSummary(file) {
  return {
    id: file._id || file.reservationId,
    reservationId: file.reservationId || file._id,
    userId: file.userId,
    appId: file.appId,
    status: file.status,
    kind: file.kind || '',
    slotKey: file.slotKey || '',
    fileName: file.fileName || '',
    contentType: file.contentType || '',
    storageKey: file.storageKey || '',
    fileId: file.fileId || '',
    storageProvider: file.storageProvider || '',
    storageBucket: file.storageBucket || '',
    storageRegion: file.storageRegion || '',
    objectKey: file.objectKey || file.storageKey || '',
    objectETag: file.objectETag || '',
    sha256Candidate: file.sha256Candidate || '',
    sizeBytes: safeNonNegativeInteger(file.sizeBytes),
    reservedSizeBytes: safeNonNegativeInteger(file.reservedSizeBytes),
    reservationExpiresAt: file.reservationExpiresAt || null,
    createdAt: file.createdAt || null,
    updatedAt: file.updatedAt || file.finalizedAt || file.createdAt || null,
    finalizedAt: file.finalizedAt || null,
    deletedAt: file.deletedAt || null,
  }
}

function normalizeMediaType(value) {
  return typeof value === 'string'
    ? value.split(';', 1)[0].trim().toLowerCase()
    : ''
}

function isInlineTextContentType(value) {
  const mediaType = normalizeMediaType(value)
  return mediaType.startsWith('text/')
    || mediaType === 'application/json'
    || mediaType.endsWith('+json')
}

async function adjustQuotaUsage(db, { userId, usedDelta = 0, reservedDelta = 0, now = Date.now() }) {
  const uid = assertUserId(userId)
  for (let attempt = 0; attempt < STORAGE_QUOTA_MAX_RETRY; attempt++) {
    const quota = await syncUserStorageQuota(db, { userId: uid, now })
    const nextUsedBytes = Math.max(0, quota.usedBytes + usedDelta)
    const nextReservedBytes = Math.max(0, quota.reservedBytes + reservedDelta)
    const result = await db
      .collection(USER_STORAGE_QUOTAS_COLLECTION)
      .where({ _id: uid, version: quota.version })
      .update({
        usedBytes: nextUsedBytes,
        reservedBytes: nextReservedBytes,
        version: quota.version + 1,
        updatedAt: now,
      })
    const updated = result?.updated ?? result?.modifiedCount ?? 0
    if (updated > 0) {
      return normalizeQuotaDoc({
        ...quota,
        usedBytes: nextUsedBytes,
        reservedBytes: nextReservedBytes,
        version: quota.version + 1,
        updatedAt: now,
      })
    }
  }
  throw new Error('更新云空间用量并发冲突，请重试')
}

async function tryReserveQuota(db, { userId, sizeBytes, now = Date.now() }) {
  const uid = assertUserId(userId)
  for (let attempt = 0; attempt < STORAGE_QUOTA_MAX_RETRY; attempt++) {
    const quota = await syncUserStorageQuota(db, { userId: uid, now })
    if (quota.usedBytes + quota.reservedBytes + sizeBytes > quota.quotaBytes) {
      const availableBytes = Math.max(0, quota.quotaBytes - quota.usedBytes - quota.reservedBytes)
      throw new Error(`云空间容量不足：剩余 ${availableBytes} bytes，本次需要 ${sizeBytes} bytes`)
    }

    const nextReservedBytes = quota.reservedBytes + sizeBytes
    const result = await db
      .collection(USER_STORAGE_QUOTAS_COLLECTION)
      .where({ _id: uid, version: quota.version })
      .update({
        reservedBytes: nextReservedBytes,
        version: quota.version + 1,
        updatedAt: now,
      })
    const updated = result?.updated ?? result?.modifiedCount ?? 0
    if (updated > 0) {
      return normalizeQuotaDoc({
        ...quota,
        reservedBytes: nextReservedBytes,
        version: quota.version + 1,
        updatedAt: now,
      })
    }
  }
  throw new Error('预留云空间配额并发冲突，请重试')
}

async function findStorageFileByReservationId(db, { userId, reservationId }) {
  const { data } = await db
    .collection(USER_STORAGE_FILES_COLLECTION)
    .where({ userId, reservationId })
    .limit(1)
    .get()
  return Array.isArray(data) && data.length > 0 ? data[0] : null
}

async function findStorageFile(db, { userId, reservationId, fileId, storageKey }) {
  const uid = assertUserId(userId)
  if (reservationId)
    return findStorageFileByReservationId(db, { userId: uid, reservationId: assertReservationId(reservationId) })

  if (fileId) {
    const fid = assertOptionalString(fileId, 'fileId', 1024)
    const { data } = await db
      .collection(USER_STORAGE_FILES_COLLECTION)
      .where({ userId: uid, fileId: fid })
      .limit(1)
      .get()
    return Array.isArray(data) && data.length > 0 ? data[0] : null
  }

  if (storageKey) {
    const key = assertOptionalString(storageKey, 'storageKey', 1024)
    const { data } = await db
      .collection(USER_STORAGE_FILES_COLLECTION)
      .where({ userId: uid, storageKey: key })
      .limit(1)
      .get()
    return Array.isArray(data) && data.length > 0 ? data[0] : null
  }

  throw new Error('reservationId、fileId 或 storageKey 至少传一个')
}

async function markReservationExpired(db, { userId, reservationId, now = Date.now() }) {
  const file = await findStorageFileByReservationId(db, { userId, reservationId })
  if (!file)
    return null
  if (![STORAGE_FILE_STATUS.RESERVED, STORAGE_FILE_STATUS.FINALIZING].includes(file.status))
    return file

  const result = await db
    .collection(USER_STORAGE_FILES_COLLECTION)
    .where({ userId, reservationId, status: file.status })
    .update({
      status: STORAGE_FILE_STATUS.EXPIRED,
      expiredAt: now,
      updatedAt: now,
    })
  const updated = result?.updated ?? result?.modifiedCount ?? 0
  if (updated > 0) {
    await adjustQuotaUsage(db, {
      userId,
      reservedDelta: -safeNonNegativeInteger(file.reservedSizeBytes || file.sizeBytes),
      now,
    })
    return { ...file, status: STORAGE_FILE_STATUS.EXPIRED, expiredAt: now, updatedAt: now }
  }
  return findStorageFileByReservationId(db, { userId, reservationId })
}

async function cleanupExpiredReservations(db, { userId, now = Date.now(), limit = 100 }) {
  const uid = assertUserId(userId)
  let expired = 0
  for (const status of [STORAGE_FILE_STATUS.RESERVED, STORAGE_FILE_STATUS.FINALIZING]) {
    const { data } = await db
      .collection(USER_STORAGE_FILES_COLLECTION)
      .where({ userId: uid, status })
      .limit(limit)
      .get()
    const items = Array.isArray(data) ? data : []
    for (const item of items) {
      if (typeof item.reservationExpiresAt === 'number' && item.reservationExpiresAt <= now) {
        await markReservationExpired(db, { userId: uid, reservationId: item.reservationId, now })
        expired += 1
      }
    }
  }
  return { expired }
}

async function getStorageQuota(db, { userId, now = Date.now() }) {
  const uid = assertUserId(userId)
  await cleanupExpiredReservations(db, { userId: uid, now })
  const quota = await syncUserStorageQuota(db, { userId: uid, now })
  return toQuotaSnapshot(quota)
}

async function reserveStorageUpload(db, input) {
  if (!input || typeof input !== 'object')
    throw new Error('参数必须为对象')

  const userId = assertUserId(input.userId)
  const appId = assertAppId(input.appId || 'yunle')
  const sizeBytes = assertByteSize(input.sizeBytes, 'sizeBytes')
  const fileName = normalizeFileName(input.fileName)
  const contentType = assertOptionalString(input.contentType, 'contentType', 160)
  const kind = assertStorageKind(input.kind)
  const slotKey = assertStorageSlotKey(input.slotKey)
  const policy = resolveStoragePolicy({ appId, contentType, fileName, kind, sizeBytes, slotKey })
  if (sizeBytes > policy.maxBytes)
    throw new Error(`单文件不能超过 ${policy.maxBytes} bytes`)

  const now = input.now || Date.now()
  await cleanupExpiredReservations(db, { userId, now })

  const reservationId = input.reservationId
    ? assertReservationId(input.reservationId)
    : makeReservationId()
  const existing = await findStorageFileByReservationId(db, { userId, reservationId })
  if (existing) {
    if (existing.status === STORAGE_FILE_STATUS.ACTIVE || existing.status === STORAGE_FILE_STATUS.DELETED) {
      const quota = await syncUserStorageQuota(db, { userId, now })
      return { quota: toQuotaSnapshot(quota), file: toFileSummary(existing), deduped: true }
    }
    if (existing.status === STORAGE_FILE_STATUS.RESERVED && existing.reservationExpiresAt > now) {
      const quota = await syncUserStorageQuota(db, { userId, now })
      return { quota: toQuotaSnapshot(quota), file: toFileSummary(existing), deduped: true }
    }
    throw new Error('该 reservationId 已过期或正在确认，请重新发起预留')
  }

  const storageKey = makeStorageKey({ userId, appId, reservationId, fileName })
  const reservationExpiresAt = now + STORAGE_RESERVATION_TTL_MS
  const sha256Input = assertOptionalString(input.sha256, 'sha256', 128)
  const sha256Candidate = kind === STORAGE_FILE_KIND.ASSET ? sha256Input.toLowerCase() : ''
  if (sha256Candidate && !/^[a-f0-9]{64}$/.test(sha256Candidate))
    throw new Error('sha256 必须为 64 位十六进制字符串')

  const quota = await tryReserveQuota(db, { userId, sizeBytes, now })
  const fileDoc = {
    _id: reservationId,
    reservationId,
    userId,
    appId,
    status: STORAGE_FILE_STATUS.RESERVED,
    kind,
    slotKey,
    fileName,
    contentType,
    storageKey,
    fileId: '',
    sizeBytes: 0,
    reservedSizeBytes: sizeBytes,
    ...(kind === STORAGE_FILE_KIND.ASSET
      ? { sha256Candidate }
      : { sha256: sha256Input }),
    reservationExpiresAt,
    createdAt: now,
    updatedAt: now,
  }

  try {
    await db.collection(USER_STORAGE_FILES_COLLECTION).add(fileDoc)
  }
  catch (err) {
    await adjustQuotaUsage(db, { userId, reservedDelta: -sizeBytes, now })
    throw err
  }

  return {
    quota: toQuotaSnapshot(quota),
    file: toFileSummary(fileDoc),
    deduped: false,
  }
}

function assertDeleteFileSucceeded(result) {
  if (!result)
    return
  if (result.code)
    throw new Error(`删除云存储对象失败: ${result.code}`)
  const item = Array.isArray(result.fileList) ? result.fileList[0] : null
  if (!item || !item.code)
    return
  const okCodes = new Set(['SUCCESS', 'OK', 'FILE_NOT_EXISTS', 'FILE_NOT_FOUND', 'NOT_FOUND', 'RESOURCE_NOT_FOUND'])
  if (!okCodes.has(item.code))
    throw new Error(`删除云存储对象失败: ${item.code}`)
}

async function finalizeStorageUpload(db, input, options = {}) {
  if (!input || typeof input !== 'object')
    throw new Error('参数必须为对象')

  const userId = assertUserId(input.userId)
  const reservationId = assertReservationId(input.reservationId)

  const now = input.now || Date.now()
  let file = await findStorageFileByReservationId(db, { userId, reservationId })
  if (!file)
    throw new Error('上传预留不存在')
  if (file.status === STORAGE_FILE_STATUS.ACTIVE) {
    const policy = resolveStoredFilePolicy(file)
    const quota = policy.singleton
      ? await replaceActiveSingletonFiles(db, {
          currentReservationId: reservationId,
          file,
          now,
          userId,
        }, options)
      : await syncUserStorageQuota(db, { userId, now })
    return { quota: toQuotaSnapshot(quota), file: toFileSummary(file), deduped: true }
  }
  if (file.status !== STORAGE_FILE_STATUS.RESERVED)
    throw new Error(`当前文件状态不能 finalize: ${file.status}`)
  if (typeof file.reservationExpiresAt === 'number' && file.reservationExpiresAt <= now) {
    await markReservationExpired(db, { userId, reservationId, now })
    throw new Error('上传预留已过期，请重新上传')
  }

  const inputStorageKey = assertOptionalString(input.storageKey, 'storageKey', 1024)
  if (inputStorageKey && inputStorageKey !== file.storageKey)
    throw new Error('storageKey 与上传预留不匹配')

  if (typeof options.readFileInfo !== 'function')
    throw new Error('私有存储对象校验能力不可用')
  if (typeof options.describeObject !== 'function')
    throw new Error('私有存储对象描述能力不可用')
  const objectDescriptor = options.describeObject(file.storageKey)
  const fileId = assertOptionalString(objectDescriptor?.fileId, 'fileId', 1024)
  if (!fileId)
    throw new Error('私有存储对象引用无效')

  const lockResult = await db
    .collection(USER_STORAGE_FILES_COLLECTION)
    .where({ userId, reservationId, status: STORAGE_FILE_STATUS.RESERVED })
    .update({
      status: STORAGE_FILE_STATUS.FINALIZING,
      finalizeStartedAt: now,
      updatedAt: now,
    })
  const locked = lockResult?.updated ?? lockResult?.modifiedCount ?? 0
  if (locked <= 0) {
    file = await findStorageFileByReservationId(db, { userId, reservationId })
    if (file?.status === STORAGE_FILE_STATUS.ACTIVE) {
      const quota = await syncUserStorageQuota(db, { userId, now })
      return { quota: toQuotaSnapshot(quota), file: toFileSummary(file), deduped: true }
    }
    throw new Error('上传正在确认中，请稍后重试')
  }

  let fileInfo
  try {
    fileInfo = await options.readFileInfo(file.storageKey)
  }
  catch (err) {
    await db
      .collection(USER_STORAGE_FILES_COLLECTION)
      .where({ userId, reservationId, status: STORAGE_FILE_STATUS.FINALIZING })
      .update({
        status: STORAGE_FILE_STATUS.RESERVED,
        finalizeErrorAt: now,
        updatedAt: now,
      })
    throw new Error(`确认私有存储对象失败: ${err.message || String(err)}`)
  }
  const actualSizeBytes = assertByteSize(fileInfo.sizeBytes, 'actualSizeBytes')
  const reservedSizeBytes = safeNonNegativeInteger(file.reservedSizeBytes)
  const policy = resolveStoredFilePolicy(file)
  const expectedContentType = normalizeMediaType(file.contentType)
  const actualContentType = normalizeMediaType(fileInfo.contentType)

  if (
    actualSizeBytes > reservedSizeBytes
    || actualSizeBytes > policy.maxBytes
    || (expectedContentType && expectedContentType !== actualContentType)
  ) {
    if (options.deleteFile)
      assertDeleteFileSucceeded(await options.deleteFile(file.storageKey))
    await markReservationExpired(db, { userId, reservationId, now })
    if (expectedContentType && expectedContentType !== actualContentType)
      throw new Error('实际文件 Content-Type 与上传预留不匹配')
    throw new Error('实际文件大小超过预留额度')
  }

  const quota = await adjustQuotaUsage(db, {
    userId,
    usedDelta: actualSizeBytes,
    reservedDelta: -reservedSizeBytes,
    now,
  })

  const activePatch = {
    status: STORAGE_FILE_STATUS.ACTIVE,
    fileId,
    sizeBytes: actualSizeBytes,
    contentType: fileInfo.contentType || file.contentType || '',
    storageProvider: objectDescriptor.storageProvider || '',
    storageBucket: objectDescriptor.storageBucket || '',
    storageRegion: objectDescriptor.storageRegion || '',
    objectKey: objectDescriptor.objectKey || file.storageKey,
    objectETag: assertOptionalString(fileInfo.etag, 'etag', 256),
    finalizedAt: now,
    updatedAt: now,
  }
  await db
    .collection(USER_STORAGE_FILES_COLLECTION)
    .where({ userId, reservationId, status: STORAGE_FILE_STATUS.FINALIZING })
    .update(activePatch)

  const finalQuota = policy.singleton
    ? await replaceActiveSingletonFiles(db, {
        currentReservationId: reservationId,
        file: { ...file, ...activePatch },
        now,
        userId,
      }, options)
    : quota

  return {
    quota: toQuotaSnapshot(finalQuota),
    file: toFileSummary({ ...file, ...activePatch }),
    deduped: false,
  }
}

async function replaceActiveSingletonFiles(db, { currentReservationId, file, now, userId }, options = {}) {
  const kind = file.kind || ''
  const slotKey = file.slotKey || ''
  if (!kind)
    return syncUserStorageQuota(db, { userId, now })

  const { data } = await db
    .collection(USER_STORAGE_FILES_COLLECTION)
    .where({
      userId,
      appId: file.appId,
      kind,
      slotKey,
      status: STORAGE_FILE_STATUS.ACTIVE,
    })
    .limit(100)
    .get()
  const items = Array.isArray(data) ? data : []

  let releasedBytes = 0
  for (const item of items) {
    if (item.reservationId === currentReservationId)
      continue

    if (options.deleteFile && item.storageKey)
      assertDeleteFileSucceeded(await options.deleteFile(item.storageKey))

    const result = await db
      .collection(USER_STORAGE_FILES_COLLECTION)
      .where({ userId, reservationId: item.reservationId, status: STORAGE_FILE_STATUS.ACTIVE })
      .update({
        status: STORAGE_FILE_STATUS.DELETED,
        deletedAt: now,
        replacedByReservationId: currentReservationId,
        updatedAt: now,
      })
    const updated = result?.updated ?? result?.modifiedCount ?? 0
    if (updated > 0)
      releasedBytes += safeNonNegativeInteger(item.sizeBytes)
  }

  if (releasedBytes > 0)
    return adjustQuotaUsage(db, { userId, usedDelta: -releasedBytes, now })
  return syncUserStorageQuota(db, { userId, now })
}

async function deleteStorageFile(db, input, options = {}) {
  if (!input || typeof input !== 'object')
    throw new Error('参数必须为对象')

  const userId = assertUserId(input.userId)
  const now = input.now || Date.now()
  const file = await findStorageFile(db, {
    userId,
    reservationId: input.reservationId,
    fileId: input.fileId,
    storageKey: input.storageKey,
  })
  if (!file)
    throw new Error('文件不存在')

  if (file.status === STORAGE_FILE_STATUS.DELETED || file.status === STORAGE_FILE_STATUS.EXPIRED) {
    const quota = await syncUserStorageQuota(db, { userId, now })
    return { quota: toQuotaSnapshot(quota), file: toFileSummary(file), deduped: true }
  }

  if (options.deleteFile && file.storageKey)
    assertDeleteFileSucceeded(await options.deleteFile(file.storageKey))

  const result = await db
    .collection(USER_STORAGE_FILES_COLLECTION)
    .where({ userId, reservationId: file.reservationId, status: file.status })
    .update({
      status: STORAGE_FILE_STATUS.DELETED,
      deletedAt: now,
      updatedAt: now,
    })
  const updated = result?.updated ?? result?.modifiedCount ?? 0
  if (updated <= 0) {
    const latest = await findStorageFileByReservationId(db, { userId, reservationId: file.reservationId })
    const quota = await syncUserStorageQuota(db, { userId, now })
    return { quota: toQuotaSnapshot(quota), file: toFileSummary(latest || file), deduped: true }
  }

  const quota = file.status === STORAGE_FILE_STATUS.ACTIVE
    ? await adjustQuotaUsage(db, { userId, usedDelta: -safeNonNegativeInteger(file.sizeBytes), now })
    : await adjustQuotaUsage(db, { userId, reservedDelta: -safeNonNegativeInteger(file.reservedSizeBytes), now })

  return {
    quota: toQuotaSnapshot(quota),
    file: toFileSummary({ ...file, status: STORAGE_FILE_STATUS.DELETED, deletedAt: now, updatedAt: now }),
    deduped: false,
  }
}

async function downloadStorageFile(db, input, options = {}) {
  if (!input || typeof input !== 'object')
    throw new Error('参数必须为对象')

  const userId = assertUserId(input.userId)
  const file = await findStorageFile(db, {
    userId,
    reservationId: input.reservationId,
    fileId: input.fileId,
    storageKey: input.storageKey,
  })
  if (!file)
    throw new Error('文件不存在')
  if (file.status !== STORAGE_FILE_STATUS.ACTIVE)
    throw new Error(`当前文件状态不能下载: ${file.status}`)
  if (!file.storageKey)
    throw new Error('文件对象不存在')

  const policy = resolveStoredFilePolicy(file)
  const maxBytes = assertOptionalPositiveInteger(input.maxBytes, 'maxBytes', policy.maxBytes, policy.maxBytes)
  const sizeBytes = safeNonNegativeInteger(file.sizeBytes)
  if (sizeBytes <= 0)
    throw new Error('文件大小无效')
  if (sizeBytes > maxBytes)
    throw new Error(`文件超过下载上限: ${maxBytes} bytes`)

  let downloadUrl = ''
  let downloadUrlExpiresAt = null
  if (options.createDownloadUrl) {
    const signed = await options.createDownloadUrl(file.storageKey)
    if (typeof signed === 'string') {
      downloadUrl = signed
    }
    else {
      downloadUrl = signed?.url || ''
      downloadUrlExpiresAt = signed?.expiresAt || null
    }
  }

  let text
  if (
    sizeBytes <= INLINE_DOWNLOAD_MAX_BYTES
    && isInlineTextContentType(file.contentType)
    && options.downloadFile
  ) {
    const content = await options.downloadFile(file.storageKey)
    text = downloadFileContentToUtf8Text(content)
    const actualBytes = Buffer.byteLength(text, 'utf8')
    if (actualBytes > INLINE_DOWNLOAD_MAX_BYTES || actualBytes > maxBytes)
      throw new Error(`文件超过下载上限: ${maxBytes} bytes`)
  }

  if (!text && !downloadUrl)
    throw new Error('私有存储对象下载能力不可用')

  const quota = await syncUserStorageQuota(db, { userId, now: input.now || Date.now() })
  return {
    file: toFileSummary(file),
    quota: toQuotaSnapshot(quota),
    ...(downloadUrl ? { downloadUrl } : {}),
    ...(downloadUrlExpiresAt ? { downloadUrlExpiresAt } : {}),
    ...(text != null ? { text } : {}),
  }
}

function downloadFileContentToUtf8Text(result) {
  if (result && result.code && !isSuccessCode(result.code))
    throw new Error(`读取云存储对象失败: ${result.code}`)

  const content = result && typeof result === 'object' && Object.hasOwn(result, 'fileContent')
    ? result.fileContent
    : result

  if (typeof content === 'string')
    return content
  if (Buffer.isBuffer(content))
    return content.toString('utf8')
  if (content instanceof ArrayBuffer)
    return Buffer.from(content).toString('utf8')
  if (ArrayBuffer.isView(content))
    return Buffer.from(content.buffer, content.byteOffset, content.byteLength).toString('utf8')

  throw new Error('读取云存储对象失败: EMPTY_CONTENT')
}

function isSuccessCode(code) {
  const normalized = String(code).toLowerCase()
  return normalized === 'success' || normalized === 'ok' || normalized === '0'
}

async function listStorageFiles(db, { userId, appId, kind, slotKey, skip = 0, limit = 20, includeDeleted = false }) {
  const uid = assertUserId(userId)
  const n = Math.min(Math.max(Number(limit) || 20, 1), 100)
  const s = Math.max(Number(skip) || 0, 0)
  const query = { userId: uid }
  if (appId)
    query.appId = assertAppId(appId)
  const normalizedKind = assertStorageKind(kind)
  if (normalizedKind)
    query.kind = normalizedKind
  const normalizedSlotKey = assertStorageSlotKey(slotKey)
  if (normalizedSlotKey)
    query.slotKey = normalizedSlotKey
  if (!includeDeleted)
    query.status = STORAGE_FILE_STATUS.ACTIVE

  const { data } = await db
    .collection(USER_STORAGE_FILES_COLLECTION)
    .where(query)
    .orderBy('createdAt', 'desc')
    .skip(s)
    .limit(n)
    .get()
  const items = Array.isArray(data) ? data.map(toFileSummary) : []
  const quota = await syncUserStorageQuota(db, { userId: uid, now: Date.now() })
  return {
    items,
    nextSkip: items.length === n ? s + n : null,
    quota: toQuotaSnapshot(quota),
  }
}

module.exports = {
  USER_STORAGE_QUOTAS_COLLECTION,
  USER_STORAGE_FILES_COLLECTION,
  NORMAL_STORAGE_QUOTA_BYTES,
  MEMBER_STORAGE_QUOTA_BYTES,
  SINGLE_FILE_LIMIT_BYTES,
  BRUSH_LIBRARY_MAX_BYTES,
  INLINE_DOWNLOAD_MAX_BYTES,
  STORAGE_RESERVATION_TTL_MS,
  STORAGE_FILE_STATUS,
  STORAGE_FILE_KIND,
  syncUserStorageQuota,
  getStorageQuota,
  reserveStorageUpload,
  finalizeStorageUpload,
  downloadStorageFile,
  deleteStorageFile,
  listStorageFiles,
  cleanupExpiredReservations,
}
