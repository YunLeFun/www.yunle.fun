import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'

import {
  _private,
  assertPrivateStorageKey,
  createPrivateCosStorage,
  makeCosObjectRef,
} from '../../cloudfunctions/user-storage-api/cos-storage.js'

const NOW = 1_700_000_000_000
const STORAGE_KEY = 'user-storage/u1/saier/res_12345678/project.json'

function makeCosClient() {
  return {
    deleteObject: vi.fn((params, callback) => callback(null, { statusCode: 204 })),
    getObject: vi.fn((params, callback) => callback(null, { Body: Buffer.from('{"ok":true}') })),
    getObjectUrl: vi.fn((params, callback) => callback(null, {
      Url: `https://yunlefun-private-1325586649.cos.ap-shanghai.myqcloud.com/${params.Key}?q-signature=test&x-cos-security-token=temporary`,
    })),
    headObject: vi.fn((params, callback) => callback(null, {
      ETag: '"etag-1"',
      headers: {
        'content-length': '512',
        'content-type': 'application/json',
      },
    })),
  }
}

describe('user-storage-api private COS adapter', () => {
  it('只为精确对象键生成短期 PUT/GET 签名 URL', async () => {
    const cosClient = makeCosClient()
    const storage = createPrivateCosStorage({
      cosClient,
      downloadUrlTtlSeconds: 300,
      now: () => NOW,
      uploadUrlTtlSeconds: 600,
    })

    const upload = await storage.createUploadUrl(STORAGE_KEY, 'application/json')
    expect(upload).toMatchObject({
      expiresAt: NOW + 600_000,
      headers: { 'Content-Type': 'application/json' },
      method: 'PUT',
    })
    expect(upload.url).toContain('?q-signature=')
    expect(upload.url).toContain('&x-cos-security-token=')
    expect(cosClient.getObjectUrl).toHaveBeenNthCalledWith(1, {
      Bucket: 'yunlefun-private-1325586649',
      Region: 'ap-shanghai',
      Key: STORAGE_KEY,
      Method: 'PUT',
      Sign: true,
      Expires: 600,
      Headers: { 'Content-Type': 'application/json' },
    }, expect.any(Function))

    const download = await storage.createDownloadUrl(STORAGE_KEY)
    expect(download).toMatchObject({
      expiresAt: NOW + 300_000,
    })
    expect(cosClient.getObjectUrl).toHaveBeenNthCalledWith(2, {
      Bucket: 'yunlefun-private-1325586649',
      Region: 'ap-shanghai',
      Key: STORAGE_KEY,
      Method: 'GET',
      Sign: true,
      Expires: 300,
    }, expect.any(Function))
  })

  it('通过服务端 HEAD/GET/DELETE 校验和管理对象', async () => {
    const cosClient = makeCosClient()
    const storage = createPrivateCosStorage({ cosClient })

    await expect(storage.headObject(STORAGE_KEY)).resolves.toEqual({
      contentType: 'application/json',
      etag: '"etag-1"',
      sizeBytes: 512,
    })
    await expect(storage.getObject(STORAGE_KEY)).resolves.toEqual(Buffer.from('{"ok":true}'))
    await expect(storage.deleteObject(STORAGE_KEY)).resolves.toMatchObject({ statusCode: 204 })

    for (const method of ['headObject', 'getObject', 'deleteObject']) {
      expect(cosClient[method]).toHaveBeenCalledWith({
        Bucket: 'yunlefun-private-1325586649',
        Region: 'ap-shanghai',
        Key: STORAGE_KEY,
      }, expect.any(Function))
    }
  })

  it('数据库对象引用不包含签名参数', () => {
    const storage = createPrivateCosStorage({ cosClient: makeCosClient() })

    expect(storage.describeObject(STORAGE_KEY)).toEqual({
      fileId: makeCosObjectRef('yunlefun-private-1325586649', STORAGE_KEY),
      objectKey: STORAGE_KEY,
      storageBucket: 'yunlefun-private-1325586649',
      storageProvider: 'cos',
      storageRegion: 'ap-shanghai',
    })
    expect(storage.describeObject(STORAGE_KEY).fileId).not.toContain('?')
  })

  it('拒绝越界对象键、控制字符和非 HTTPS 签名 URL', async () => {
    for (const key of [
      '/user-storage/u1/file',
      'avatars/u1.png',
      'user-storage/u1/../secret',
      'user-storage/u1\\secret',
      'user-storage/u1/\nsecret',
    ]) {
      expect(() => assertPrivateStorageKey(key)).toThrow()
    }

    const cosClient = makeCosClient()
    cosClient.getObjectUrl.mockImplementation((params, callback) => callback(null, {
      Url: `http://example.com/${params.Key}?q-signature=test`,
    }))
    const storage = createPrivateCosStorage({ cosClient })
    await expect(storage.createDownloadUrl(STORAGE_KEY)).rejects.toThrow(/不安全/)
  })

  it('运行时只接受带 session token 的临时角色凭证', () => {
    const constructed = []
    class FakeCOS {
      constructor(options) {
        constructed.push(options)
      }
    }

    expect(() => _private.createRuntimeCosClient({
      TENCENTCLOUD_SECRETID: 'temporary-id',
      TENCENTCLOUD_SECRETKEY: 'temporary-key',
    }, FakeCOS)).toThrow(/临时凭证/)

    _private.createRuntimeCosClient({
      TENCENTCLOUD_SECRETID: 'temporary-id',
      TENCENTCLOUD_SECRETKEY: 'temporary-key',
      TENCENTCLOUD_SESSIONTOKEN: 'session-token',
    }, FakeCOS)
    expect(constructed).toEqual([{
      SecretId: 'temporary-id',
      SecretKey: 'temporary-key',
      SecurityToken: 'session-token',
    }])
  })
})
