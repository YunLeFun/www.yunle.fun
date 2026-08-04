'use strict'

const { Buffer } = require('node:buffer')
const { createHash, timingSafeEqual } = require('node:crypto')
const process = require('node:process')

const DEFAULT_PRIVATE_BUCKET = 'yunlefun-drive-prod-1325586649'
const DEFAULT_PUBLIC_BUCKET = '7975-yunlefun-8g7ybcxc7345c490-1325586649'
const DEFAULT_REGION = 'ap-shanghai'
const DEFAULT_PUBLIC_BASE_URL = `https://${DEFAULT_PUBLIC_BUCKET}.tcb.qcloud.la`
const MAX_SIMPLE_COPY_BYTES = 5 * 1024 ** 3

function requiredString(value, field, maxLength = 2048) {
  if (typeof value !== 'string' || !value || value.length > maxLength || /\p{Cc}/u.test(value))
    throw new Error(`${field} 配置无效`)
  return value
}

function safeIdentifier(value, field) {
  const identifier = requiredString(value, field, 128)
  if (!/^[a-z0-9][\w.-]{0,127}$/iu.test(identifier))
    throw new Error(`${field} 格式无效`)
  return identifier
}

function safeExtension(value) {
  const extension = requiredString(value, 'extension', 8).toLowerCase()
  if (!/^[a-z0-9]{1,8}$/u.test(extension))
    throw new Error('extension 格式无效')
  return extension
}

function safePositiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_SIMPLE_COPY_BYTES)
    throw new Error(`${field} 必须是 1~5GiB 的安全整数`)
  return value
}

function normalizeContentType(value) {
  const contentType = requiredString(value, 'contentType', 160).trim().toLowerCase()
  if (!/^[a-z0-9][\w!#$&^.+-]*\/[a-z0-9][\w!#$&^.+-]*(?:\s*;[^\r\n]+)?$/iu.test(contentType))
    throw new Error('contentType 格式无效')
  if (/^(?:text\/html|image\/svg\+xml|application\/(?:javascript|x-javascript|xml|xhtml\+xml))(?:;|$)/iu.test(contentType))
    throw new Error('首期公开发布不接受可执行文档类型')
  return contentType
}

function normalizeSha256(value) {
  const sha256 = requiredString(value, 'sha256', 64).toLowerCase()
  if (!/^[a-f0-9]{64}$/u.test(sha256))
    throw new Error('sha256 格式无效')
  return sha256
}

function parseAllowedUserIds(value) {
  return new Set(String(value || '').split(',').map(item => item.trim()).filter(Boolean).map(item => safeIdentifier(item, 'allowedUserId')))
}

function verifyServiceToken(provided, expected) {
  const actual = Buffer.from(String(provided || ''))
  const wanted = Buffer.from(String(expected || ''))
  if (wanted.length < 32 || actual.length !== wanted.length || !timingSafeEqual(actual, wanted))
    throw new Error('发布服务鉴权失败')
}

function assertSourceKey(sourceKey, input) {
  const key = requiredString(sourceKey, 'sourceKey', 1024)
  const prefix = `private/${input.tenantId}/${input.projectId}/${input.assetId}/`
  if (!key.startsWith(prefix) || key.startsWith('/') || key.includes('\\'))
    throw new Error('私有源对象不在当前 Drive 素材范围内')
  if (key.split('/').some(segment => !segment || segment === '.' || segment === '..'))
    throw new Error('私有源对象路径无效')
  if (key.slice(prefix.length).includes('/'))
    throw new Error('私有源对象必须是素材目录中的单个源文件')
  return key
}

function assertPublicKey(publicKey, input) {
  const key = requiredString(publicKey, 'publicKey', 1024)
  const expected = [
    'published',
    'users',
    input.userId,
    'projects',
    input.projectId,
    'assets',
    input.assetId,
    `${input.sha256}.${input.extension}`,
  ].join('/')
  if (key !== expected)
    throw new Error('公开目标对象路径不是规范的不可变发布路径')
  return key
}

function encodeObjectKey(key) {
  return key.split('/').map(segment => encodeURIComponent(segment)).join('/')
}

function headerValue(headers, name) {
  if (!headers || typeof headers !== 'object')
    return ''
  const target = name.toLowerCase()
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === target)
  return entry ? String(entry[1] ?? '') : ''
}

function objectInfo(result) {
  const headers = result?.headers || {}
  const bytes = Number(headerValue(headers, 'content-length'))
  if (!Number.isSafeInteger(bytes) || bytes <= 0)
    throw new Error('COS 对象大小无效')
  return {
    bytes,
    cacheControl: headerValue(headers, 'cache-control'),
    contentDisposition: headerValue(headers, 'content-disposition'),
    contentType: headerValue(headers, 'content-type').trim().toLowerCase(),
    crc64: headerValue(headers, 'x-cos-hash-crc64ecma'),
    etag: String(result?.ETag || headerValue(headers, 'etag') || '').trim(),
    sha256: headerValue(headers, 'x-cos-meta-sha256').trim().toLowerCase(),
  }
}

async function headObject(cos, input, options = {}) {
  try {
    return objectInfo(await cos.headObject({
      Bucket: input.bucket,
      Key: input.key,
      Region: input.region,
    }))
  }
  catch (error) {
    if (options.optional && (error?.statusCode === 404 || ['NoSuchKey', 'NotFound'].includes(error?.code)))
      return null
    throw error
  }
}

function hashObject(cos, input) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    let bytes = 0
    let settled = false
    let stream
    try {
      stream = cos.getObjectStream({
        Bucket: input.bucket,
        Key: input.key,
        Region: input.region,
      })
    }
    catch (error) {
      reject(error)
      return
    }
    stream.on('data', (chunk) => {
      const body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      bytes += body.length
      hash.update(body)
    })
    stream.once('error', (error) => {
      if (!settled) {
        settled = true
        reject(error)
      }
    })
    stream.once('end', () => {
      if (!settled) {
        settled = true
        resolve({ bytes, sha256: hash.digest('hex') })
      }
    })
  })
}

function assertPublishedObject(target, source, expected) {
  if (target.bytes !== source.bytes || target.bytes !== expected.bytes)
    throw new Error('公开副本大小校验失败')
  if (source.crc64 && target.crc64 && source.crc64 !== target.crc64)
    throw new Error('公开副本 CRC64 校验失败')
  if (target.sha256 !== expected.sha256)
    throw new Error('公开副本 SHA-256 元数据校验失败')
  if (target.contentType !== expected.contentType)
    throw new Error('公开副本 Content-Type 校验失败')
  if (target.contentDisposition.toLowerCase() !== 'inline')
    throw new Error('公开副本 Content-Disposition 校验失败')
  if (target.cacheControl !== 'public, max-age=31536000, immutable')
    throw new Error('公开副本缓存策略校验失败')
}

function createRuntimeCosClient(env = process.env, COSCtor) {
  const SecretId = String(env.TENCENTCLOUD_SECRETID || '').trim()
  const SecretKey = String(env.TENCENTCLOUD_SECRETKEY || '').trim()
  const SecurityToken = String(env.TENCENTCLOUD_SESSIONTOKEN || '').trim()
  if (!SecretId || !SecretKey || !SecurityToken)
    throw new Error('发布函数缺少最小权限运行角色临时凭证')
  const COS = COSCtor || require('cos-nodejs-sdk-v5')
  return new COS({ SecretId, SecretKey, SecurityToken })
}

function createPublisher(options = {}) {
  const env = options.env || process.env
  const privateBucket = String(env.DRIVE_PRIVATE_COS_BUCKET || DEFAULT_PRIVATE_BUCKET).trim()
  const privateRegion = String(env.DRIVE_PRIVATE_COS_REGION || DEFAULT_REGION).trim()
  const publicBucket = String(env.DRIVE_PUBLIC_COS_BUCKET || DEFAULT_PUBLIC_BUCKET).trim()
  const publicRegion = String(env.DRIVE_PUBLIC_COS_REGION || DEFAULT_REGION).trim()
  const publicBaseUrl = String(env.DRIVE_PUBLIC_BASE_URL || DEFAULT_PUBLIC_BASE_URL).replace(/\/$/u, '')
  const sourceTenantId = safeIdentifier(env.DRIVE_PUBLISH_SOURCE_TENANT_ID, 'sourceTenantId')
  const allowedUserIds = parseAllowedUserIds(env.DRIVE_PUBLISH_ALLOWED_USER_IDS)
  if (!/^[a-z0-9][a-z0-9-]{0,62}-\d+$/u.test(privateBucket) || !/^[a-z0-9][a-z0-9-]{0,62}-\d+$/u.test(publicBucket))
    throw new Error('发布 COS Bucket 配置无效')
  if (!/^ap-[a-z0-9-]+$/u.test(privateRegion) || !/^ap-[a-z0-9-]+$/u.test(publicRegion))
    throw new Error('发布 COS Region 配置无效')
  let publicOrigin
  try {
    publicOrigin = new URL(publicBaseUrl)
  }
  catch {
    throw new Error('公开访问域名配置无效')
  }
  if (publicOrigin.protocol !== 'https:' || publicOrigin.origin !== publicBaseUrl || publicOrigin.username || publicOrigin.password)
    throw new Error('公开访问域名必须使用 HTTPS')
  if (allowedUserIds.size === 0)
    throw new Error('发布 UID 白名单不能为空')
  let cos = options.cos || null

  return async function publish(event) {
    if (event?.action !== 'publish')
      throw new Error('未知发布操作')
    verifyServiceToken(event?.serviceToken, env.DRIVE_PUBLISH_INTERNAL_TOKEN)
    const userId = safeIdentifier(event?.userId, 'userId')
    if (!allowedUserIds.has(userId))
      throw new Error('当前用户不在发布白名单中')
    const projectId = safeIdentifier(event?.projectId, 'projectId')
    const assetId = safeIdentifier(event?.assetId, 'assetId')
    const extension = safeExtension(event?.extension)
    const sha256 = normalizeSha256(event?.sha256)
    const bytes = safePositiveInteger(event?.bytes, 'bytes')
    const contentType = normalizeContentType(event?.contentType)
    const sourceKey = assertSourceKey(event?.sourceKey, { assetId, projectId, tenantId: sourceTenantId })
    const publicKey = assertPublicKey(event?.publicKey, { assetId, extension, projectId, sha256, userId })
    cos ||= createRuntimeCosClient(env, options.COSCtor)

    const sourceLocation = { bucket: privateBucket, key: sourceKey, region: privateRegion }
    const targetLocation = { bucket: publicBucket, key: publicKey, region: publicRegion }
    const source = await headObject(cos, sourceLocation)
    if (!source.etag)
      throw new Error('私有源对象缺少 ETag，不能执行条件复制')
    if (source.bytes !== bytes)
      throw new Error('私有源对象大小与发布声明不一致')
    if (source.contentType !== contentType)
      throw new Error('私有源对象 Content-Type 与发布声明不一致')
    const digest = await hashObject(cos, sourceLocation)
    if (digest.bytes !== bytes || digest.sha256 !== sha256)
      throw new Error('私有源对象 SHA-256 与发布声明不一致')

    const existing = await headObject(cos, targetLocation, { optional: true })
    if (existing) {
      assertPublishedObject(existing, source, { bytes, contentType, sha256 })
      return { deduped: true, publicKey, publicUrl: `${publicBaseUrl}/${publicKey}`, status: 'ready' }
    }

    await cos.putObjectCopy({
      'Bucket': publicBucket,
      'CacheControl': 'public, max-age=31536000, immutable',
      'ContentDisposition': 'inline',
      'ContentType': contentType,
      'CopySource': `${privateBucket}.cos.${privateRegion}.myqcloud.com/${encodeObjectKey(sourceKey)}`,
      'CopySourceIfMatch': source.etag,
      'Key': publicKey,
      'MetadataDirective': 'Replaced',
      'Region': publicRegion,
      'x-cos-meta-sha256': sha256,
    })

    const target = await headObject(cos, targetLocation)
    assertPublishedObject(target, source, { bytes, contentType, sha256 })
    return { deduped: false, publicKey, publicUrl: `${publicBaseUrl}/${publicKey}`, status: 'ready' }
  }
}

module.exports = {
  DEFAULT_PRIVATE_BUCKET,
  DEFAULT_PUBLIC_BASE_URL,
  DEFAULT_PUBLIC_BUCKET,
  DEFAULT_REGION,
  createPublisher,
  createRuntimeCosClient,
  _private: {
    assertPublicKey,
    assertPublishedObject,
    assertSourceKey,
    encodeObjectKey,
    hashObject,
    normalizeContentType,
    parseAllowedUserIds,
    verifyServiceToken,
  },
}
