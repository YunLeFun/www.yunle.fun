/**
 * 私有 COS 对象访问适配层。
 *
 * 只接受 user-storage/ 前缀下的精确对象键；签名 URL 仅作为短期响应返回，
 * 数据库只保存不含凭证的 cos://bucket/key 引用。
 */

'use strict'

const { Buffer } = require('node:buffer')
const { createHash } = require('node:crypto')
const process = require('node:process')
const { Writable } = require('node:stream')
const { finished } = require('node:stream/promises')
const { inspectAssetHeader } = require('./asset-image')

const DEFAULT_PRIVATE_COS_BUCKET = 'yunlefun-private-1325586649'
const DEFAULT_PRIVATE_COS_REGION = 'ap-shanghai'
const DEFAULT_UPLOAD_URL_TTL_SECONDS = 10 * 60
const DEFAULT_DOWNLOAD_URL_TTL_SECONDS = 5 * 60
const PRIVATE_STORAGE_PREFIX = 'user-storage/'
const ASSET_HEADER_BYTES = 2 * 1024 * 1024
const MAX_ASSET_BYTES = 200 * 1024 * 1024

function assertPrivateStorageKey(value) {
  if (typeof value !== 'string' || !value.trim())
    throw new Error('COS 对象键不能为空')
  const key = value.trim()
  if (key !== value || key.length > 1024)
    throw new Error('COS 对象键格式无效')
  if (!key.startsWith(PRIVATE_STORAGE_PREFIX) || key.startsWith('/') || key.includes('\\'))
    throw new Error('COS 对象键不在私有用户存储范围内')
  if (key.split('/').some(segment => !segment || segment === '.' || segment === '..'))
    throw new Error('COS 对象键包含无效路径段')
  if (Array.from(key).some(ch => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127))
    throw new Error('COS 对象键包含控制字符')
  return key
}

function assertBucket(value) {
  const bucket = String(value || '').trim()
  if (!/^[a-z0-9][a-z0-9-]{0,62}-\d+$/.test(bucket))
    throw new Error('私有 COS Bucket 配置无效')
  return bucket
}

function assertRegion(value) {
  const region = String(value || '').trim()
  if (!/^[a-z][a-z0-9-]{1,31}$/.test(region))
    throw new Error('私有 COS Region 配置无效')
  return region
}

function readTtlSeconds(value, fallback) {
  if (value == null || value === '')
    return fallback
  const seconds = Number(value)
  if (!Number.isSafeInteger(seconds) || seconds < 60 || seconds > 3600)
    throw new Error('COS 签名 URL 有效期必须为 60~3600 秒')
  return seconds
}

function normalizeContentType(value) {
  if (value == null || value === '')
    return ''
  if (typeof value !== 'string' || value.length > 160 || /[\r\n]/.test(value))
    throw new Error('Content-Type 格式无效')
  return value.trim().toLowerCase()
}

function createRuntimeCosClient(env = process.env, COSCtor) {
  const SecretId = String(env.TENCENTCLOUD_SECRETID || '').trim()
  const SecretKey = String(env.TENCENTCLOUD_SECRETKEY || '').trim()
  const SecurityToken = String(env.TENCENTCLOUD_SESSIONTOKEN || '').trim()
  if (!SecretId || !SecretKey || !SecurityToken)
    throw new Error('COS 运行时临时凭证不可用，请为云函数配置最小权限运行角色')

  // Node.js 18 运行时不内置 COS SDK；保持延迟加载，避免非存储 action 无谓初始化。
  const COS = COSCtor || require('cos-nodejs-sdk-v5')
  return new COS({ SecretId, SecretKey, SecurityToken })
}

function callCos(cosClient, method, params) {
  if (!cosClient || typeof cosClient[method] !== 'function')
    throw new Error(`COS ${method} 能力不可用`)
  return new Promise((resolve, reject) => {
    cosClient[method](params, (err, data) => {
      if (err)
        reject(err)
      else
        resolve(data || {})
    })
  })
}

function readHeader(headers, name) {
  if (!headers || typeof headers !== 'object')
    return ''
  const target = name.toLowerCase()
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === target)
  return entry ? entry[1] : ''
}

function assertSignedHttpsUrl(value) {
  if (typeof value !== 'string' || !value)
    throw new Error('COS 未返回签名 URL')
  let parsed
  try {
    parsed = new URL(value)
  }
  catch {
    throw new Error('COS 返回的签名 URL 无效')
  }
  const hasSignature = parsed.searchParams.has('q-signature') || parsed.searchParams.has('sign')
  const hasSessionToken = parsed.searchParams.has('x-cos-security-token')
  if (parsed.protocol !== 'https:' || !hasSignature || !hasSessionToken)
    throw new Error('COS 返回的签名 URL 不安全')
  return value
}

function makeCosObjectRef(bucket, storageKey) {
  return `cos://${assertBucket(bucket)}/${assertPrivateStorageKey(storageKey)}`
}

function createPrivateCosStorage(options = {}) {
  const env = options.env || process.env
  const bucket = assertBucket(options.bucket || env.PRIVATE_COS_BUCKET || DEFAULT_PRIVATE_COS_BUCKET)
  const region = assertRegion(options.region || env.PRIVATE_COS_REGION || DEFAULT_PRIVATE_COS_REGION)
  const uploadUrlTtlSeconds = readTtlSeconds(
    options.uploadUrlTtlSeconds ?? env.PRIVATE_COS_UPLOAD_URL_TTL_SECONDS,
    DEFAULT_UPLOAD_URL_TTL_SECONDS,
  )
  const downloadUrlTtlSeconds = readTtlSeconds(
    options.downloadUrlTtlSeconds ?? env.PRIVATE_COS_DOWNLOAD_URL_TTL_SECONDS,
    DEFAULT_DOWNLOAD_URL_TTL_SECONDS,
  )
  const now = typeof options.now === 'function' ? options.now : Date.now
  let cosClient = options.cosClient || null

  function getCosClient() {
    if (!cosClient)
      cosClient = createRuntimeCosClient(env, options.COSCtor)
    return cosClient
  }

  async function createSignedUrl({ contentType = '', disposition = '', method, storageKey, ttlSeconds }) {
    const key = assertPrivateStorageKey(storageKey)
    const normalizedContentType = normalizeContentType(contentType)
    const Headers = normalizedContentType ? { 'Content-Type': normalizedContentType } : undefined
    const result = await callCos(getCosClient(), 'getObjectUrl', {
      Bucket: bucket,
      Region: region,
      Key: key,
      Method: method,
      Sign: true,
      Expires: ttlSeconds,
      ...(Headers ? { Headers } : {}),
      ...(disposition ? { Query: { 'response-content-disposition': disposition === 'attachment' ? 'attachment; filename="asset"' : 'inline' } } : {}),
    })
    return {
      url: assertSignedHttpsUrl(result.Url),
      expiresAt: now() + ttlSeconds * 1000,
      ...(Headers ? { headers: Headers } : {}),
    }
  }

  return {
    bucket,
    region,

    async createUploadUrl(storageKey, contentType) {
      const signed = await createSignedUrl({
        contentType,
        method: 'PUT',
        storageKey,
        ttlSeconds: uploadUrlTtlSeconds,
      })
      return {
        method: 'PUT',
        ...signed,
      }
    },

    async createDownloadUrl(storageKey, disposition = '') {
      return await createSignedUrl({
        disposition,
        method: 'GET',
        storageKey,
        ttlSeconds: downloadUrlTtlSeconds,
      })
    },

    async headObject(storageKey) {
      const key = assertPrivateStorageKey(storageKey)
      const result = await callCos(getCosClient(), 'headObject', {
        Bucket: bucket,
        Region: region,
        Key: key,
      })
      const sizeBytes = Number(readHeader(result.headers, 'content-length'))
      if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0)
        throw new Error('COS 对象大小无效')
      return {
        sizeBytes,
        contentType: normalizeContentType(readHeader(result.headers, 'content-type')),
        etag: String(result.ETag || readHeader(result.headers, 'etag') || '').trim(),
      }
    },

    async getObject(storageKey) {
      const key = assertPrivateStorageKey(storageKey)
      const result = await callCos(getCosClient(), 'getObject', {
        Bucket: bucket,
        Region: region,
        Key: key,
      })
      return result.Body
    },

    async acceptAsset(stagingKey, expected) {
      const sourceKey = assertPrivateStorageKey(stagingKey)
      const acceptedKey = assertPrivateStorageKey(`${sourceKey}.accepted`)
      if (!expected || !expected.etag || !Number.isSafeInteger(expected.sizeBytes) || expected.sizeBytes < 1 || expected.sizeBytes > MAX_ASSET_BYTES)
        throw new Error('素材原图验收参数无效')
      await callCos(getCosClient(), 'putObjectCopy', {
        Bucket: bucket,
        Region: region,
        Key: acceptedKey,
        CopySource: `${bucket}.cos.${region}.myqcloud.com/${encodeURIComponent(sourceKey)}`,
        CopySourceIfMatch: expected.etag,
        MetadataDirective: 'Copy',
      })
      try {
        const accepted = await this.headObject(acceptedKey)
        if (!accepted.etag || accepted.sizeBytes !== expected.sizeBytes || accepted.contentType !== expected.contentType)
          throw new Error('素材原图副本与上传预留不匹配')
        const hash = createHash('sha256')
        let sizeBytes = 0
        let header = Buffer.alloc(0)
        const output = new Writable({
          write(chunk, _encoding, callback) {
            sizeBytes += chunk.length
            if (sizeBytes > expected.sizeBytes || sizeBytes > MAX_ASSET_BYTES) {
              callback(new Error('素材原图超过上传预留大小'))
              return
            }
            hash.update(chunk)
            if (header.length < ASSET_HEADER_BYTES)
              header = Buffer.concat([header, chunk.subarray(0, ASSET_HEADER_BYTES - header.length)])
            callback()
          },
        })
        await callCos(getCosClient(), 'getObject', {
          Bucket: bucket,
          Region: region,
          Key: acceptedKey,
          IfMatch: accepted.etag,
          Output: output,
        })
        await finished(output)
        if (sizeBytes !== accepted.sizeBytes)
          throw new Error('素材原图流大小与私有副本不匹配')
        const inspection = inspectAssetHeader(header, expected.contentType)
        return {
          storageKey: acceptedKey,
          sizeBytes,
          contentType: inspection.detectedType,
          etag: accepted.etag,
          sha256: hash.digest('hex'),
          ...(inspection.width ? { width: inspection.width, height: inspection.height } : {}),
        }
      }
      catch (error) {
        await this.deleteObject(acceptedKey).catch(() => {})
        throw error
      }
    },

    async deleteObject(storageKey) {
      const key = assertPrivateStorageKey(storageKey)
      return await callCos(getCosClient(), 'deleteObject', {
        Bucket: bucket,
        Region: region,
        Key: key,
      })
    },

    describeObject(storageKey) {
      const objectKey = assertPrivateStorageKey(storageKey)
      return {
        fileId: makeCosObjectRef(bucket, objectKey),
        storageProvider: 'cos',
        storageBucket: bucket,
        storageRegion: region,
        objectKey,
      }
    },
  }
}

module.exports = {
  DEFAULT_PRIVATE_COS_BUCKET,
  DEFAULT_PRIVATE_COS_REGION,
  DEFAULT_UPLOAD_URL_TTL_SECONDS,
  DEFAULT_DOWNLOAD_URL_TTL_SECONDS,
  PRIVATE_STORAGE_PREFIX,
  assertPrivateStorageKey,
  createPrivateCosStorage,
  makeCosObjectRef,
  _private: {
    assertBucket,
    assertRegion,
    assertSignedHttpsUrl,
    callCos,
    createRuntimeCosClient,
    normalizeContentType,
    readHeader,
    readTtlSeconds,
  },
}
