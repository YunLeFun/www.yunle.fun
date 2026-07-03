import { describe, expect, it } from 'vitest'

import {
  BRUSH_LIBRARY_MAX_BYTES,
  finalizeStorageUpload,
  listStorageFiles,
  reserveStorageUpload,
  STORAGE_FILE_KIND,
  STORAGE_FILE_STATUS,
  USER_STORAGE_FILES_COLLECTION,
} from '../../cloudfunctions/user-storage-api/storage.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = 1_700_000_000_000

function fileIdFor(storageKey) {
  return `cloud://yunlefun-8g7ybcxc7345c490.abc/${storageKey}`
}

async function reserveBrushLibrary(db, reservationId, sizeBytes, now) {
  return await reserveStorageUpload(db, {
    userId: 'u1',
    appId: 'saier',
    contentType: 'application/json',
    fileName: 'brush-library.saier.brushes.json',
    kind: STORAGE_FILE_KIND.BRUSH_LIBRARY,
    reservationId,
    sizeBytes,
    slotKey: 'default',
    now,
  })
}

describe('user-storage-api brush library policy', () => {
  it('rejects invalid brush-library reservations before storage upload', async () => {
    const db = makeFakeDb()

    await expect(
      reserveStorageUpload(db, {
        userId: 'u1',
        appId: 'saier',
        contentType: 'application/json',
        fileName: 'brush-library.saier.brushes.json',
        kind: STORAGE_FILE_KIND.BRUSH_LIBRARY,
        sizeBytes: BRUSH_LIBRARY_MAX_BYTES + 1,
        slotKey: 'default',
        now: NOW,
      }),
    ).rejects.toThrow(/brush-library/)

    await expect(
      reserveStorageUpload(db, {
        userId: 'u1',
        appId: 'saier',
        contentType: 'text/plain',
        fileName: 'brush-library.saier.brushes.json',
        kind: STORAGE_FILE_KIND.BRUSH_LIBRARY,
        sizeBytes: 1024,
        slotKey: 'default',
        now: NOW,
      }),
    ).rejects.toThrow(/contentType/)

    await expect(
      reserveStorageUpload(db, {
        userId: 'u1',
        appId: 'saier',
        contentType: 'application/json',
        fileName: 'wrong.json',
        kind: STORAGE_FILE_KIND.BRUSH_LIBRARY,
        sizeBytes: 1024,
        slotKey: 'default',
        now: NOW,
      }),
    ).rejects.toThrow(/文件名/)
  })

  it('stores kind and slotKey in file summaries', async () => {
    const db = makeFakeDb()

    const reserved = await reserveBrushLibrary(db, 'brush_reserve1', 1024, NOW)

    expect(reserved.file).toMatchObject({
      appId: 'saier',
      fileName: 'brush-library.saier.brushes.json',
      kind: STORAGE_FILE_KIND.BRUSH_LIBRARY,
      slotKey: 'default',
      status: STORAGE_FILE_STATUS.RESERVED,
    })
  })

  it('replaces the previous active brush library and releases quota', async () => {
    const db = makeFakeDb()
    const deletedFileIds = []

    const first = await reserveBrushLibrary(db, 'brush_first1', 4096, NOW)
    await finalizeStorageUpload(
      db,
      { userId: 'u1', reservationId: 'brush_first1', fileId: fileIdFor(first.file.storageKey), now: NOW + 1 },
      { readFileInfo: async () => ({ sizeBytes: 2048, contentType: 'application/json' }) },
    )

    const second = await reserveBrushLibrary(db, 'brush_second1', 4096, NOW + 2)
    const finalized = await finalizeStorageUpload(
      db,
      { userId: 'u1', reservationId: 'brush_second1', fileId: fileIdFor(second.file.storageKey), now: NOW + 3 },
      {
        deleteFile: async (fileId) => {
          deletedFileIds.push(fileId)
          return { fileList: [{ code: 'SUCCESS', fileID: fileId }] }
        },
        readFileInfo: async () => ({ sizeBytes: 1024, contentType: 'application/json' }),
      },
    )

    expect(finalized.quota.usedBytes).toBe(1024)
    expect(finalized.quota.reservedBytes).toBe(0)
    expect(deletedFileIds).toEqual([fileIdFor(first.file.storageKey)])

    const rows = db._store[USER_STORAGE_FILES_COLLECTION]
    expect(rows.find(item => item.reservationId === 'brush_first1')).toMatchObject({
      replacedByReservationId: 'brush_second1',
      status: STORAGE_FILE_STATUS.DELETED,
    })
    expect(rows.find(item => item.reservationId === 'brush_second1')).toMatchObject({
      status: STORAGE_FILE_STATUS.ACTIVE,
    })

    const listed = await listStorageFiles(db, {
      userId: 'u1',
      appId: 'saier',
      kind: STORAGE_FILE_KIND.BRUSH_LIBRARY,
      slotKey: 'default',
    })
    expect(listed.items).toHaveLength(1)
    expect(listed.items[0]).toMatchObject({
      reservationId: 'brush_second1',
      kind: STORAGE_FILE_KIND.BRUSH_LIBRARY,
      slotKey: 'default',
    })
  })
})
