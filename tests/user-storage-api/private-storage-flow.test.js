import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'

import storageRouter from '../../cloudfunctions/user-storage-api/router.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const { dispatch } = storageRouter

function makePrivateStorage() {
  return {
    createDownloadUrl: vi.fn(async () => ({
      expiresAt: Date.now() + 300_000,
      url: 'https://private.example/object?q-signature=download',
    })),
    createUploadUrl: vi.fn(async () => ({
      expiresAt: Date.now() + 600_000,
      headers: { 'Content-Type': 'application/json' },
      method: 'PUT',
      url: 'https://private.example/object?q-signature=upload',
    })),
    deleteObject: vi.fn(async () => ({})),
    describeObject: vi.fn(storageKey => ({
      fileId: `cos://yunlefun-private-1325586649/${storageKey}`,
      objectKey: storageKey,
      storageBucket: 'yunlefun-private-1325586649',
      storageProvider: 'cos',
      storageRegion: 'ap-shanghai',
    })),
    getObject: vi.fn(async () => Buffer.from('{"version":1}')),
    headObject: vi.fn(async () => ({
      contentType: 'application/json',
      etag: '"etag-flow"',
      sizeBytes: 13,
    })),
  }
}

function makeDeps(db, privateStorage) {
  return {
    callAccountApi: async () => ({ restricted: false, state: 'active' }),
    db,
    privateStorage,
    serviceToken: 'test-internal-token',
    userId: 'u1',
  }
}

describe('user-storage-api private storage flow', () => {
  it('预留后签发 PUT，finalize 由服务端 HEAD 确认，再按登录用户签发下载和删除', async () => {
    const db = makeFakeDb()
    const privateStorage = makePrivateStorage()
    const deps = makeDeps(db, privateStorage)

    const reserved = await dispatch({
      action: 'reserveStorageUpload',
      appId: 'saier',
      contentType: 'application/json',
      fileName: 'canvas.saier.project.json',
      kind: 'project',
      reservationId: 'res_private1',
      sizeBytes: 1024,
    }, deps)

    expect(reserved.upload).toMatchObject({
      headers: { 'Content-Type': 'application/json' },
      method: 'PUT',
    })
    expect(privateStorage.createUploadUrl).toHaveBeenCalledWith(
      reserved.file.storageKey,
      'application/json',
    )

    const finalized = await dispatch({
      action: 'finalizeStorageUpload',
      fileId: 'https://attacker.example/ignored',
      reservationId: 'res_private1',
    }, deps)
    expect(privateStorage.headObject).toHaveBeenCalledWith(reserved.file.storageKey)
    expect(finalized.file).toMatchObject({
      fileId: `cos://yunlefun-private-1325586649/${reserved.file.storageKey}`,
      objectETag: '"etag-flow"',
      objectKey: reserved.file.storageKey,
      status: 'active',
      storageProvider: 'cos',
    })

    const downloaded = await dispatch({
      action: 'downloadStorageFile',
      reservationId: 'res_private1',
    }, deps)
    expect(downloaded).toMatchObject({
      downloadUrl: 'https://private.example/object?q-signature=download',
      text: '{"version":1}',
    })
    expect(privateStorage.createDownloadUrl).toHaveBeenCalledWith(reserved.file.storageKey)
    expect(privateStorage.getObject).toHaveBeenCalledWith(reserved.file.storageKey)

    const deleted = await dispatch({
      action: 'deleteStorageFile',
      reservationId: 'res_private1',
    }, deps)
    expect(privateStorage.deleteObject).toHaveBeenCalledWith(reserved.file.storageKey)
    expect(deleted.file.status).toBe('deleted')
    expect(deleted.quota.usedBytes).toBe(0)
  })
})
