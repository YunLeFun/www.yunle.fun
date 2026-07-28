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
  return `cos://yunlefun-private-1325586649/${storageKey}`
}

function privateStorageOptions(fileInfo, overrides = {}) {
  return {
    describeObject: storageKey => ({
      fileId: fileIdFor(storageKey),
      objectKey: storageKey,
      storageBucket: 'yunlefun-private-1325586649',
      storageProvider: 'cos',
      storageRegion: 'ap-shanghai',
    }),
    readFileInfo: async () => fileInfo,
    ...overrides,
  }
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
      { userId: 'u1', reservationId: 'brush_first1', now: NOW + 1 },
      privateStorageOptions({ sizeBytes: 2048, contentType: 'application/json' }),
    )

    await reserveBrushLibrary(db, 'brush_second1', 4096, NOW + 2)
    const finalized = await finalizeStorageUpload(
      db,
      { userId: 'u1', reservationId: 'brush_second1', now: NOW + 3 },
      privateStorageOptions(
        { sizeBytes: 1024, contentType: 'application/json' },
        {
          deleteFile: async (storageKey) => {
            deletedFileIds.push(storageKey)
            return {}
          },
        },
      ),
    )

    expect(finalized.quota.usedBytes).toBe(1024)
    expect(finalized.quota.reservedBytes).toBe(0)
    expect(deletedFileIds).toEqual([first.file.storageKey])

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

  it('finalize 重试会继续清理尚未替换成功的旧 singleton', async () => {
    const db = makeFakeDb()
    const first = await reserveBrushLibrary(db, 'brush_retry_old', 4096, NOW)
    await finalizeStorageUpload(
      db,
      { userId: 'u1', reservationId: 'brush_retry_old', now: NOW + 1 },
      privateStorageOptions({ sizeBytes: 2048, contentType: 'application/json' }),
    )

    await reserveBrushLibrary(db, 'brush_retry_new', 4096, NOW + 2)
    await expect(
      finalizeStorageUpload(
        db,
        { userId: 'u1', reservationId: 'brush_retry_new', now: NOW + 3 },
        privateStorageOptions(
          { sizeBytes: 1024, contentType: 'application/json' },
          {
            deleteFile: async () => {
              throw new Error('temporary delete failure')
            },
          },
        ),
      ),
    ).rejects.toThrow(/temporary delete failure/)

    const retried = await finalizeStorageUpload(
      db,
      { userId: 'u1', reservationId: 'brush_retry_new', now: NOW + 4 },
      {
        deleteFile: async () => ({}),
      },
    )
    expect(retried).toMatchObject({
      deduped: true,
      quota: { usedBytes: 1024 },
    })
    expect(db._store[USER_STORAGE_FILES_COLLECTION].find(
      item => item.reservationId === first.file.reservationId,
    )).toMatchObject({
      replacedByReservationId: 'brush_retry_new',
      status: STORAGE_FILE_STATUS.DELETED,
    })
  })
})
