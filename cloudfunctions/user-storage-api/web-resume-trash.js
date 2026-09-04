/** Private 30-day trash lifecycle for Web Resume metadata and storage objects. */

'use strict'

const { randomUUID } = require('node:crypto')
const { deleteStorageFile } = require('./storage')

const WEB_RESUME_DOCUMENTS_COLLECTION = 'web_resume_documents'
const PURGE_LEASE_MS = 15 * 60 * 1000
const PURGE_RETRY_MS = 60 * 60 * 1000

async function sweepWebResumeTrash(database, input = {}, dependencies = {}) {
  const now = Number.isSafeInteger(input.now) ? input.now : Date.now()
  const limit = Number.isSafeInteger(input.limit) ? Math.min(Math.max(input.limit, 1), 50) : 20
  if (!database?.command || typeof database.runTransaction !== 'function')
    throw new Error('Web Resume 回收站数据库能力不可用')
  if (typeof dependencies.deleteFile !== 'function')
    throw new Error('Web Resume 回收站对象删除能力不可用')

  const collection = database.collection(WEB_RESUME_DOCUMENTS_COLLECTION)
  const due = await collection.where({
    purgeAfter: database.command.lte(now),
    recordType: 'web_resume_document',
    state: 'trashed',
  }).limit(limit).get()
  const remaining = Math.max(0, limit - documentList(due).length)
  const stale = remaining > 0
    ? await collection.where({
        purgeLeaseExpiresAt: database.command.lte(now),
        recordType: 'web_resume_document',
        state: 'purging',
      }).limit(remaining).get()
    : { data: [] }
  const candidates = [...documentList(due), ...documentList(stale)]
  const result = { ok: true, scanned: candidates.length, purged: 0, deferred: 0, errors: 0 }

  for (const candidate of candidates) {
    const attemptId = randomUUID()
    const claimed = await claimDocument(database, candidate._id, attemptId, now)
    if (!claimed) {
      result.deferred++
      continue
    }
    try {
      if (claimed.currentReservationId) {
        await deleteStorageFile(database, {
          now,
          reservationId: claimed.currentReservationId,
          userId: claimed.userId,
        }, { deleteFile: dependencies.deleteFile })
      }
      await removeClaimedDocument(database, claimed._id, attemptId)
      result.purged++
    }
    catch {
      result.errors++
      await releaseClaim(database, claimed._id, attemptId, now).catch(() => undefined)
    }
  }
  return result
}

async function claimDocument(database, documentId, attemptId, now) {
  if (typeof documentId !== 'string')
    return null
  return database.runTransaction(async (transaction) => {
    const reference = transaction.collection(WEB_RESUME_DOCUMENTS_COLLECTION).doc(documentId)
    const current = firstDocument(await reference.get())
    const isDueTrash = current?.state === 'trashed' && Number.isSafeInteger(current.purgeAfter) && current.purgeAfter <= now
    const isStalePurge = current?.state === 'purging' && Number.isSafeInteger(current.purgeLeaseExpiresAt) && current.purgeLeaseExpiresAt <= now
    if (
      (!isDueTrash && !isStalePurge)
      || current.recordType !== 'web_resume_document'
      || typeof current.userId !== 'string'
    ) {
      return null
    }
    await assertUpdated(reference.update({
      purgeAttemptId: attemptId,
      purgeLeaseExpiresAt: now + PURGE_LEASE_MS,
      purgeStartedAt: current.purgeStartedAt || now,
      state: 'purging',
      updatedAt: now,
      version: Number.isSafeInteger(current.version) ? current.version + 1 : 1,
    }))
    return { ...current, _id: documentId, purgeAttemptId: attemptId, state: 'purging' }
  }, 3)
}

async function removeClaimedDocument(database, documentId, attemptId) {
  await database.runTransaction(async (transaction) => {
    const reference = transaction.collection(WEB_RESUME_DOCUMENTS_COLLECTION).doc(documentId)
    const current = firstDocument(await reference.get())
    if (!current || current.state !== 'purging' || current.purgeAttemptId !== attemptId)
      throw new Error('Web Resume 回收站清理租约已失效')
    assertResult(await reference.remove())
  }, 3)
}

async function releaseClaim(database, documentId, attemptId, now) {
  await database.runTransaction(async (transaction) => {
    const reference = transaction.collection(WEB_RESUME_DOCUMENTS_COLLECTION).doc(documentId)
    const current = firstDocument(await reference.get())
    if (!current || current.state !== 'purging' || current.purgeAttemptId !== attemptId)
      return
    await assertUpdated(reference.update({
      purgeAfter: now + PURGE_RETRY_MS,
      purgeAttemptId: null,
      purgeLeaseExpiresAt: null,
      state: 'trashed',
      updatedAt: now,
      version: Number.isSafeInteger(current.version) ? current.version + 1 : 1,
    }))
  }, 3)
}

function documentList(result) {
  assertResult(result)
  return Array.isArray(result.data) ? result.data.filter(isRecord) : []
}

function firstDocument(result) {
  assertResult(result)
  if (Array.isArray(result.data))
    return isRecord(result.data[0]) ? result.data[0] : null
  return isRecord(result.data) && Object.keys(result.data).length ? result.data : null
}

function assertResult(result) {
  if (!isRecord(result) || (result.code !== undefined && result.code !== 0 && result.code !== '0'))
    throw new Error('Web Resume 回收站数据库操作失败')
}

async function assertUpdated(resultPromise) {
  const result = await resultPromise
  assertResult(result)
  const updated = result.updated ?? result.modifiedCount
  if (updated !== undefined && (!Number.isSafeInteger(updated) || Number(updated) < 1))
    throw new Error('Web Resume 回收站状态发生冲突')
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

module.exports = {
  PURGE_LEASE_MS,
  PURGE_RETRY_MS,
  WEB_RESUME_DOCUMENTS_COLLECTION,
  claimDocument,
  releaseClaim,
  sweepWebResumeTrash,
}
