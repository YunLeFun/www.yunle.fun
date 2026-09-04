import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

import storageRouter from '../../cloudfunctions/user-storage-api/router.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const TOKEN = 'web-resume-test-token-at-least-32-bytes'
const YAML = 'basics:\n  name: Yun\n'
const YAML_SHA256 = createHash('sha256').update(YAML).digest('hex')

function deps(db) {
  return {
    callAccountApi: async () => ({ restricted: false, state: 'active' }),
    db,
    privateStorage: {
      createDownloadUrl: vi.fn(async () => ({ url: 'https://private.example/get?q-signature=x' })),
      createUploadUrl: vi.fn(async () => ({
        headers: { 'Content-Type': 'application/yaml' },
        method: 'PUT',
        url: 'https://private.example/put?q-signature=x',
      })),
      deleteObject: vi.fn(async () => ({})),
      describeObject: vi.fn(storageKey => ({ fileId: `cos://private/${storageKey}`, objectKey: storageKey })),
      getObject: vi.fn(async () => Buffer.from(YAML)),
      headObject: vi.fn(async () => ({ contentType: 'application/yaml', sizeBytes: 20 })),
    },
    serviceToken: 'account-api-test-token',
    webResumeStorageToken: TOKEN,
  }
}

function delegated(operation, payload = {}, overrides = {}) {
  return {
    action: 'invokeForWebResume',
    appId: 'web-resume',
    operation,
    payload,
    serviceToken: TOKEN,
    userId: 'u1',
    ...overrides,
  }
}

describe('user-storage-api Web Resume delegation', () => {
  it('forces the application, kind and YAML content type', async () => {
    const db = makeFakeDb()
    const result = await storageRouter.dispatch(delegated('reserveStorageUpload', {
      appId: 'other',
      contentType: 'text/html',
      fileName: 'work.resume.yml',
      kind: 'project',
      reservationId: 'resume_delegate1',
      sha256: YAML_SHA256,
      sizeBytes: 1024,
      slotKey: 'doc_1234567890abcdef',
    }), deps(db))

    expect(result.file).toMatchObject({
      appId: 'web-resume',
      contentType: 'application/yaml',
      kind: 'resume',
    })
  })

  it('verifies the uploaded YAML checksum before activating it', async () => {
    const db = makeFakeDb()
    const dependencies = deps(db)
    await storageRouter.dispatch(delegated('reserveStorageUpload', {
      fileName: 'work.resume.yml',
      reservationId: 'resume_checksum1',
      sha256: YAML_SHA256,
      sizeBytes: Buffer.byteLength(YAML),
      slotKey: 'doc_1234567890abcdef',
    }), dependencies)

    const result = await storageRouter.dispatch(delegated('finalizeStorageUpload', {
      reservationId: 'resume_checksum1',
    }), dependencies)

    expect(result.file.status).toBe('active')
    expect(dependencies.privateStorage.getObject).toHaveBeenCalledOnce()
  })

  it('fails closed for missing tokens, foreign applications and unapproved operations', async () => {
    const db = makeFakeDb()
    await expect(storageRouter.dispatch(delegated('getStorageQuota', {}, { serviceToken: 'wrong' }), deps(db)))
      .rejects
      .toThrow(/鉴权失败/)
    await expect(storageRouter.dispatch(delegated('getStorageQuota', {}, { appId: 'drive' }), deps(db)))
      .rejects
      .toThrow(/应用无效/)
    await expect(storageRouter.dispatch(delegated('adminDeleteEverything'), deps(db)))
      .rejects
      .toThrow(/操作无效/)
  })

  it('cannot download a file owned by another application', async () => {
    const db = makeFakeDb({
      user_storage_files: [{
        _id: 'foreign_file1',
        reservationId: 'foreign_file1',
        userId: 'u1',
        appId: 'saier',
        kind: 'project',
        status: 'active',
      }],
    })

    await expect(storageRouter.dispatch(
      delegated('downloadStorageFile', { reservationId: 'foreign_file1' }),
      deps(db),
    )).rejects.toThrow(/不存在/)
  })
})
