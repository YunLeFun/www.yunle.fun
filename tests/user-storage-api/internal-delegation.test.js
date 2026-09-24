import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

import storageRouter from '../../cloudfunctions/user-storage-api/router.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const TOKEN = 'web-resume-test-token-at-least-32-bytes'
const DRIVE_TOKEN = 'drive-asset-test-token-at-least-32-bytes'
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
    get assetStorage() { return this.privateStorage },
    serviceToken: 'account-api-test-token',
    driveStorageToken: DRIVE_TOKEN,
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

function driveDelegated(operation, payload = {}, overrides = {}) {
  return {
    action: 'invokeForDriveAsset',
    appId: 'drive',
    operation,
    payload,
    serviceToken: DRIVE_TOKEN,
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

  it('rejects a reservationId already held by another application', async () => {
    const db = makeFakeDb({ user_storage_files: [{
      _id: 'foreign_reserved_1',
      reservationId: 'foreign_reserved_1',
      userId: 'u1',
      appId: 'drive',
      kind: 'asset',
      status: 'reserved',
      reservationExpiresAt: Date.now() + 60_000,
      reservedSizeBytes: 20,
    }] })
    const dependencies = deps(db)

    await expect(storageRouter.dispatch(delegated('reserveStorageUpload', {
      reservationId: 'foreign_reserved_1',
      fileName: 'work.resume.yml',
      sha256: YAML_SHA256,
      sizeBytes: 20,
      slotKey: 'doc_1234567890abcdef',
    }), dependencies)).rejects.toThrow(/不属于当前应用/)
    expect(dependencies.privateStorage.createUploadUrl).not.toHaveBeenCalled()
  })
})

describe('user-storage-api Drive asset delegation', () => {
  const assetInput = {
    appId: 'saier',
    contentType: 'image/png',
    fileName: 'cover.png',
    kind: 'project',
    reservationId: 'drive_asset_reserve_1',
    sha256: 'a'.repeat(64),
    sizeBytes: 1024,
    slotKey: 'foreign-slot',
  }

  it('forces the Drive asset scope and removes a caller-supplied slot', async () => {
    const db = makeFakeDb()
    const result = await storageRouter.dispatch(driveDelegated('reserveStorageUpload', assetInput), deps(db))

    expect(result.file).toMatchObject({
      appId: 'drive',
      kind: 'asset',
      slotKey: '',
      sha256Candidate: 'a'.repeat(64),
      status: 'reserved',
    })
  })

  it('uses a dedicated asset bucket and rejects direct asset lifecycle calls', async () => {
    const db = makeFakeDb()
    const dependencies = { ...deps(db) }
    dependencies.assetStorage = {
      ...dependencies.privateStorage,
      createUploadUrl: vi.fn(async () => ({ method: 'PUT', url: 'https://asset-private.example/put', headers: { 'Content-Type': 'image/png' } })),
    }
    await storageRouter.dispatch(driveDelegated('reserveStorageUpload', assetInput), dependencies)
    expect(dependencies.assetStorage.createUploadUrl).toHaveBeenCalledOnce()
    expect(dependencies.privateStorage.createUploadUrl).not.toHaveBeenCalled()

    await expect(storageRouter.dispatch({ action: 'reserveStorageUpload', appId: 'drive', kind: 'asset', contentType: 'image/png', fileName: 'other.png', reservationId: 'direct_asset_1', sha256: 'a'.repeat(64), sizeBytes: 20 }, { ...dependencies, userId: 'u1' }))
      .rejects
      .toThrow(/Drive 服务端预留/)
    for (const action of ['finalizeStorageUpload', 'downloadStorageFile', 'deleteStorageFile']) {
      await expect(storageRouter.dispatch({ action, reservationId: assetInput.reservationId }, { ...dependencies, userId: 'u1' }))
        .rejects
        .toThrow(/Drive 服务端/)
    }
  })

  it('rejects wrong tokens, wrong app IDs and operations outside the allowlist', async () => {
    const db = makeFakeDb()
    await expect(storageRouter.dispatch(driveDelegated('getStorageQuota', {}, { serviceToken: TOKEN }), deps(db)))
      .rejects
      .toThrow(/鉴权失败/)
    await expect(storageRouter.dispatch(driveDelegated('getStorageQuota', {}, { appId: 'web-resume' }), deps(db)))
      .rejects
      .toThrow(/应用无效/)
    await expect(storageRouter.dispatch(driveDelegated('sweepWebResumeTrash'), deps(db)))
      .rejects
      .toThrow(/操作无效/)
  })

  it('does not expose another application reservation or file', async () => {
    const db = makeFakeDb({ user_storage_files: [{
      _id: 'foreign_reserved_2',
      reservationId: 'foreign_reserved_2',
      userId: 'u1',
      appId: 'saier',
      kind: 'project',
      status: 'reserved',
      reservationExpiresAt: Date.now() + 60_000,
      reservedSizeBytes: 20,
    }] })
    const dependencies = deps(db)

    await expect(storageRouter.dispatch(driveDelegated('reserveStorageUpload', {
      ...assetInput,
      reservationId: 'foreign_reserved_2',
    }), dependencies)).rejects.toThrow(/不属于当前应用/)
    expect(dependencies.privateStorage.createUploadUrl).not.toHaveBeenCalled()
    await expect(storageRouter.dispatch(driveDelegated('downloadStorageFile', {
      reservationId: 'foreign_reserved_2',
    }), dependencies)).rejects.toThrow(/不存在/)
    await expect(storageRouter.dispatch(driveDelegated('deleteStorageFile', {
      reservationId: 'foreign_reserved_2',
    }), dependencies)).rejects.toThrow(/不存在/)
    await expect(storageRouter.dispatch(driveDelegated('finalizeStorageUpload', {
      reservationId: 'foreign_reserved_2',
    }), dependencies)).rejects.toThrow(/不存在/)
  })

  it('filters listings to the delegated Drive asset scope', async () => {
    const db = makeFakeDb({ user_storage_files: [
      { _id: 'drive_active_1', reservationId: 'drive_active_1', userId: 'u1', appId: 'drive', kind: 'asset', status: 'active', createdAt: 2 },
      { _id: 'saier_active_1', reservationId: 'saier_active_1', userId: 'u1', appId: 'saier', kind: 'project', status: 'active', createdAt: 1 },
    ] })
    const result = await storageRouter.dispatch(driveDelegated('listStorageFiles', {
      appId: 'saier',
      kind: 'project',
      includeDeleted: true,
    }), deps(db))
    expect(result.items.map(item => item.reservationId)).toEqual(['drive_active_1'])
  })
})
