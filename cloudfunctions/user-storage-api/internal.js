/** Server-only, application-scoped delegation into the user storage state machine. */
'use strict'

const { Buffer } = require('node:buffer')
const { timingSafeEqual } = require('node:crypto')
const process = require('node:process')

const WEB_RESUME_APP_ID = 'web-resume'
const WEB_RESUME_KIND = 'resume'
const ALLOWED_OPERATIONS = new Set([
  'deleteStorageFile',
  'downloadStorageFile',
  'finalizeStorageUpload',
  'getStorageQuota',
  'listStorageFiles',
  'reserveStorageUpload',
])

function tokensMatch(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string')
    return false
  const left = Buffer.from(provided)
  const right = Buffer.from(expected)
  return left.length >= 32 && left.length === right.length && timingSafeEqual(left, right)
}

function assertWebResumeDelegation(event, expectedToken = process.env.WEB_RESUME_STORAGE_INTERNAL_TOKEN || '') {
  if (!expectedToken)
    throw new Error('Web Resume 存储委托鉴权未配置')
  if (!tokensMatch(event?.serviceToken, expectedToken))
    throw new Error('Web Resume 存储委托鉴权失败')
  if (event?.appId !== WEB_RESUME_APP_ID)
    throw new Error('Web Resume 存储委托应用无效')
  if (!ALLOWED_OPERATIONS.has(event?.operation))
    throw new Error('Web Resume 存储委托操作无效')
  if (typeof event?.userId !== 'string' || !event.userId.trim() || event.userId.length > 128)
    throw new Error('Web Resume 存储委托用户无效')
  return {
    operation: event.operation,
    payload: event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
      ? event.payload
      : {},
    userId: event.userId.trim(),
  }
}

function assertWebResumeSweeper(event, expectedToken = process.env.WEB_RESUME_SWEEPER_INTERNAL_TOKEN || '') {
  if (!expectedToken)
    throw new Error('Web Resume 回收站清理鉴权未配置')
  if (!tokensMatch(event?.serviceToken, expectedToken))
    throw new Error('Web Resume 回收站清理鉴权失败')
}

async function assertWebResumeFileScope(db, userId, reservationId) {
  if (typeof reservationId !== 'string' || !reservationId)
    throw new Error('reservationId 必填')
  const { data } = await db.collection('user_storage_files').where({
    userId,
    reservationId,
    appId: WEB_RESUME_APP_ID,
    kind: WEB_RESUME_KIND,
  }).limit(1).get()
  const file = Array.isArray(data) ? data[0] : null
  if (!file)
    throw new Error('Web Resume 文件不存在')
  return file
}

module.exports = {
  ALLOWED_OPERATIONS,
  WEB_RESUME_APP_ID,
  WEB_RESUME_KIND,
  assertWebResumeDelegation,
  assertWebResumeFileScope,
  assertWebResumeSweeper,
  tokensMatch,
}
