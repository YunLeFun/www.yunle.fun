/**
 * 微信支付 V3 加解密与随机值工具。
 *
 * SYNCED FILE: 修改此文件后，请执行 `pnpm sync:wxpay-lib` 同步到 wxpay-notify/lib/。
 */

'use strict'

const { Buffer } = require('node:buffer')
const crypto = require('node:crypto')

const NONCE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/**
 * 生成微信支付要求的 nonce_str（默认 32 位字母数字）
 *
 * @param {number} [length]
 * @returns {string}
 */
function generateNonceStr(length = 32) {
  if (length <= 0 || length > 64) {
    throw new RangeError('generateNonceStr: length 必须在 (0, 64] 之间')
  }
  const bytes = crypto.randomBytes(length)
  let out = ''
  for (let i = 0; i < length; i++) {
    out += NONCE_ALPHABET[bytes[i] % NONCE_ALPHABET.length]
  }
  return out
}

/**
 * 生成商户订单号
 *
 * 格式：`YLF` + 13 位毫秒时间戳 + 16 位 hex 随机串，长度 32，符合微信支付 6~32 位约束。
 * 16 字节随机熵约等于 128 bit，避免可预测/碰撞风险。
 *
 * @returns {string}
 */
function generateOutTradeNo() {
  const timestamp = Date.now().toString()
  const random = crypto.randomBytes(8).toString('hex') // 16 字符
  return `YLF${timestamp}${random}`
}

/**
 * 解密微信支付 V3 回调的 resource 字段
 *
 * 使用 AES-256-GCM，密钥为商户 APIv3 Key（32 字节字符串）。
 *
 * @param {object} input
 * @param {{ ciphertext: string, nonce: string, associated_data?: string }} input.resource
 * @param {string} input.apiV3Key 32 字节字符串
 * @returns {object} 解密后的 JSON
 */
function decryptResource({ resource, apiV3Key }) {
  if (!apiV3Key || apiV3Key.length !== 32) {
    throw new Error('decryptResource: WX_APIV3_KEY 必须是 32 字节字符串')
  }
  if (!resource || !resource.ciphertext || !resource.nonce) {
    throw new Error('decryptResource: resource 字段缺失 ciphertext/nonce')
  }
  const ciphertextBuf = Buffer.from(resource.ciphertext, 'base64')
  if (ciphertextBuf.length <= 16) {
    throw new Error('decryptResource: ciphertext 长度异常')
  }
  const authTag = ciphertextBuf.slice(ciphertextBuf.length - 16)
  const data = ciphertextBuf.slice(0, ciphertextBuf.length - 16)
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    Buffer.from(apiV3Key),
    Buffer.from(resource.nonce),
  )
  decipher.setAuthTag(authTag)
  decipher.setAAD(Buffer.from(resource.associated_data || ''))
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()])
  return JSON.parse(decrypted.toString('utf8'))
}

module.exports = {
  generateNonceStr,
  generateOutTradeNo,
  decryptResource,
}
