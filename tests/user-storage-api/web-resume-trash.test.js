import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

import {
  finalizeStorageUpload,
  reserveStorageUpload,
  STORAGE_FILE_KIND,
  USER_STORAGE_FILES_COLLECTION,
} from '../../cloudfunctions/user-storage-api/storage.js'
import {
  PURGE_RETRY_MS,
  sweepWebResumeTrash,
  WEB_RESUME_DOCUMENTS_COLLECTION,
} from '../../cloudfunctions/user-storage-api/web-resume-trash.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = 1_800_000_000_000
const YAML = 'basics:\n  name: Yun\n'

async function makeTrashedResume() {
  const db = makeFakeDb()
  const sizeBytes = Buffer.byteLength(YAML)
  const reserved = await reserveStorageUpload(db, {
    appId: 'web-resume',
    contentType: 'application/yaml',
    fileName: 'work.resume.yml',
    kind: STORAGE_FILE_KIND.RESUME,
    now: NOW - 100,
    reservationId: 'resume_trash1234',
    sha256: createHash('sha256').update(YAML).digest('hex'),
    sizeBytes,
    slotKey: 'doc_1234567890abcdef',
    userId: 'u1',
  })
  await finalizeStorageUpload(db, {
    now: NOW - 90,
    reservationId: reserved.file.reservationId,
    userId: 'u1',
  }, {
    deleteFile: async () => ({}),
    describeObject: storageKey => ({ fileId: `cos://private/${storageKey}`, objectKey: storageKey }),
    downloadFile: async () => Buffer.from(YAML),
    readFileInfo: async () => ({ contentType: 'application/yaml', sizeBytes }),
  })
  await db.collection(WEB_RESUME_DOCUMENTS_COLLECTION).add({
    _id: 'doc_1234567890abcdef',
    currentReservationId: reserved.file.reservationId,
    name: 'work.resume.yml',
    purgeAfter: NOW - 1,
    recordType: 'web_resume_document',
    state: 'trashed',
    userId: 'u1',
    version: 2,
  })
  return db
}

describe('web Resume trash sweeper', () => {
  it('deletes the private object, releases quota, and removes due metadata', async () => {
    const db = await makeTrashedResume()
    const deleteFile = vi.fn(async () => ({}))

    await expect(sweepWebResumeTrash(db, { now: NOW }, { deleteFile })).resolves.toEqual({
      deferred: 0,
      errors: 0,
      ok: true,
      purged: 1,
      scanned: 1,
    })
    expect(deleteFile).toHaveBeenCalledOnce()
    expect(db._store[WEB_RESUME_DOCUMENTS_COLLECTION]).toHaveLength(0)
    expect(db._store[USER_STORAGE_FILES_COLLECTION][0].status).toBe('deleted')
    expect(db._store.user_storage_quotas[0].usedBytes).toBe(0)
  })

  it('returns a failed deletion to trash with a delayed retry', async () => {
    const db = await makeTrashedResume()
    const result = await sweepWebResumeTrash(db, { now: NOW }, {
      deleteFile: vi.fn(async () => { throw new Error('COS unavailable') }),
    })

    expect(result.errors).toBe(1)
    expect(db._store[WEB_RESUME_DOCUMENTS_COLLECTION][0]).toMatchObject({
      purgeAfter: NOW + PURGE_RETRY_MS,
      state: 'trashed',
    })
  })
})
