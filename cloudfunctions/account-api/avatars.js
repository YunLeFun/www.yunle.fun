/**
 * Account avatar upload helpers.
 *
 * Avatar images are small profile assets, so the account API owns the upload
 * and writes CloudBase Storage with server credentials. This avoids exposing a
 * broad client-side `avatars/**` write rule that cannot bind dynamic path
 * prefixes to `auth.uid` in CloudBase's storage-rule expression subset.
 */

'use strict'

const { Buffer } = require('node:buffer')

const AVATAR_MAX_BYTES = 2 * 1024 * 1024
const AVATAR_MIME_TO_EXT = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
])

function assertAvatarPayload(input) {
  if (!input || typeof input !== 'object')
    throw new Error('头像数据不能为空')

  const contentType = typeof input.contentType === 'string' ? input.contentType.trim().toLowerCase() : ''
  const ext = AVATAR_MIME_TO_EXT.get(contentType)
  if (!ext)
    throw new Error('头像格式仅支持 JPG、PNG、WebP')

  const data = typeof input.data === 'string' ? input.data.trim() : ''
  if (!data)
    throw new Error('头像数据不能为空')

  const dataUrlPrefix = `data:${contentType};base64,`
  const base64 = data.startsWith(dataUrlPrefix) ? data.slice(dataUrlPrefix.length) : data
  if (!/^[\d+/=a-z]+$/i.test(base64))
    throw new Error('头像数据不是合法 Base64')

  const fileContent = Buffer.from(base64, 'base64')
  if (fileContent.length === 0)
    throw new Error('头像数据不能为空')
  if (fileContent.length > AVATAR_MAX_BYTES)
    throw new Error('头像不能超过 2 MiB')

  return { contentType, ext, fileContent }
}

async function uploadAvatar(cloudbaseApp, { userId, avatar, now = Date.now() }) {
  if (!cloudbaseApp || typeof cloudbaseApp.uploadFile !== 'function')
    throw new Error('头像上传服务不可用')
  if (typeof userId !== 'string' || !userId.trim())
    throw new Error('请先登录')

  const uid = userId.trim()
  const { ext, fileContent } = assertAvatarPayload(avatar)
  const cloudPath = `avatars/${uid}_${Math.max(0, Number(now) || Date.now())}.${ext}`
  const uploaded = await cloudbaseApp.uploadFile({ cloudPath, fileContent })
  const fileID = uploaded?.fileID
  if (typeof fileID !== 'string' || !fileID)
    throw new Error('头像上传失败')

  return {
    fileID,
    cloudPath,
  }
}

module.exports = {
  AVATAR_MAX_BYTES,
  assertAvatarPayload,
  uploadAvatar,
}
