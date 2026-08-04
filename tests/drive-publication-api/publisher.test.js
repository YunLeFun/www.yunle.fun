import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'

import {
  createPublisher,
  createRuntimeCosClient,
} from '../../cloudfunctions/drive-publication-api/publisher.js'

const TOKEN = 't'.repeat(64)
const USER_ID = '2070545189004382208'
const BODY = Buffer.from('yunlefun-drive-publication-smoke-v1\n')
const SHA256 = createHash('sha256').update(BODY).digest('hex')
const SOURCE_KEY = 'private/yunlefun/studio/smoke-test/publication-smoke.txt'
const PUBLIC_KEY = `published/users/${USER_ID}/projects/studio/assets/smoke-test/${SHA256}.txt`
const PUBLIC_BUCKET = 'yunyoujun-assets-prod-1325586649'

function headers(input = {}) {
  return {
    'cache-control': input.cacheControl || '',
    'content-disposition': input.contentDisposition || '',
    'content-length': String(BODY.length),
    'content-type': 'text/plain',
    'etag': '"source-etag"',
    'x-cos-hash-crc64ecma': '123456789',
    'x-cos-meta-sha256': input.sha256 || '',
  }
}

function makeCos() {
  let target
  return {
    getObjectStream: vi.fn(() => Readable.from(BODY)),
    headObject: vi.fn(async ({ Bucket }) => {
      if (Bucket === PUBLIC_BUCKET) {
        if (!target)
          throw Object.assign(new Error('not found'), { code: 'NoSuchKey', statusCode: 404 })
        return { ETag: '"target-etag"', headers: target }
      }
      return { ETag: '"source-etag"', headers: headers() }
    }),
    putObjectCopy: vi.fn(async (params) => {
      target = headers({
        cacheControl: params.CacheControl,
        contentDisposition: params.ContentDisposition,
        sha256: params['x-cos-meta-sha256'],
      })
      return { CRC64: '123456789', ETag: '"target-etag"' }
    }),
  }
}

function event(overrides = {}) {
  return {
    action: 'publish',
    assetId: 'smoke-test',
    bytes: BODY.length,
    contentType: 'text/plain',
    extension: 'txt',
    projectId: 'studio',
    publicKey: PUBLIC_KEY,
    serviceToken: TOKEN,
    sha256: SHA256,
    sourceKey: SOURCE_KEY,
    userId: USER_ID,
    ...overrides,
  }
}

function publisher(cos) {
  return createPublisher({
    cos,
    env: {
      DRIVE_PUBLISH_ALLOWED_USER_IDS: USER_ID,
      DRIVE_PUBLISH_INTERNAL_TOKEN: TOKEN,
      DRIVE_PUBLISH_SOURCE_TENANT_ID: 'yunlefun',
    },
  })
}

describe('drive publication COS broker', () => {
  it('copies one exact private object to the canonical immutable public key', async () => {
    const cos = makeCos()
    await expect(publisher(cos)(event())).resolves.toEqual({
      deduped: false,
      publicKey: PUBLIC_KEY,
      publicUrl: `https://assets.yunyoujun.cn/${PUBLIC_KEY}`,
      status: 'ready',
    })
    expect(cos.putObjectCopy).toHaveBeenCalledWith(expect.objectContaining({
      'CacheControl': 'public, max-age=31536000, immutable',
      'ContentDisposition': 'inline',
      'ContentType': 'text/plain',
      'CopySource': 'yunlefun-drive-prod-1325586649.cos.ap-shanghai.myqcloud.com/private/yunlefun/studio/smoke-test/publication-smoke.txt',
      'CopySourceIfMatch': '"source-etag"',
      'Key': PUBLIC_KEY,
      'MetadataDirective': 'Replaced',
      'x-cos-meta-sha256': SHA256,
    }))
  })

  it('reuses a verified immutable target without copying twice', async () => {
    const cos = makeCos()
    const publish = publisher(cos)
    await publish(event())
    await expect(publish(event())).resolves.toMatchObject({ deduped: true, status: 'ready' })
    expect(cos.putObjectCopy).toHaveBeenCalledTimes(1)
  })

  it('rejects token, UID, source path, digest, and active-document violations', async () => {
    const cases = [
      event({ serviceToken: 'wrong' }),
      event({ userId: '1978032370372050944' }),
      event({ sourceKey: 'private/another-tenant/studio/smoke-test/private.txt' }),
      event({ sourceKey: 'private/yunlefun/another-project/smoke-test/private.txt' }),
      event({ sha256: 'a'.repeat(64), publicKey: `published/users/${USER_ID}/projects/studio/assets/smoke-test/${'a'.repeat(64)}.txt` }),
      event({ contentType: 'text/html' }),
    ]
    for (const input of cases)
      await expect(publisher(makeCos())(input)).rejects.toThrow()
  })

  it('only accepts SCF role temporary credentials at runtime', () => {
    const constructed = []
    class FakeCOS {
      constructor(options) {
        constructed.push(options)
      }
    }
    expect(() => createRuntimeCosClient({
      TENCENTCLOUD_SECRETID: 'temporary-id',
      TENCENTCLOUD_SECRETKEY: 'temporary-key',
    }, FakeCOS)).toThrow(/临时凭证/)
    createRuntimeCosClient({
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
