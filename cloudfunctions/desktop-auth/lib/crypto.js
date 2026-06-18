/**
 * desktop-auth 通用密码学小工具：随机凭证、哈希、常量时间比较、用户短码。
 *
 * 设计要点：
 *   - deviceCode / deviceRefreshToken / 兑换码等 bearer 凭证「只存哈希」，
 *     服务端比对用 sha256 + 常量时间比较，避免明文落库与 timing 侧信道。
 *   - userCode 是给用户在浏览器里核对/手输的短码，用去歧义字母表（去掉 0/O/1/I/L）。
 *
 * 纯函数、无外部依赖（只用 node:crypto），便于单测。
 */

'use strict'

const { Buffer } = require('node:buffer')
const crypto = require('node:crypto')

/** 去歧义字母表：剔除易混的 0/O/1/I/L，降低用户手输出错率 */
const USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/**
 * 生成高熵随机 bearer 凭证（base64url，无填充）。
 *
 * @param {number} [bytes] 随机字节数，默认 32（≈256bit）
 * @returns {string} base64url 随机串
 */
function randomToken(bytes = 32) {
  if (!Number.isInteger(bytes) || bytes < 16 || bytes > 64)
    throw new RangeError('randomToken: bytes 必须在 [16, 64]')
  return crypto.randomBytes(bytes).toString('base64url')
}

/**
 * 生成用户短码。默认 8 位，展示形如 `WXYZ-1234`，存储用归一化形式 `WXYZ1234`。
 *
 * @param {number} [length]
 * @returns {{ display: string, normalized: string }} 展示码（带连字符）与归一化存储码
 */
function generateUserCode(length = 8) {
  const bytes = crypto.randomBytes(length)
  let code = ''
  for (let i = 0; i < length; i++)
    code += USER_CODE_ALPHABET[bytes[i] % USER_CODE_ALPHABET.length]
  const mid = Math.ceil(length / 2)
  return { display: `${code.slice(0, mid)}-${code.slice(mid)}`, normalized: code }
}

/**
 * 归一化用户短码：去掉非字母数字（如连字符/空格）并大写，用于存储与比对。
 *
 * @param {unknown} input
 * @returns {string} 去格式化后的大写短码
 */
function normalizeUserCode(input) {
  if (typeof input !== 'string')
    return ''
  return input.replace(/[^a-z0-9]/gi, '').toUpperCase()
}

/**
 * sha256 → hex。用于把 bearer 凭证转成可落库的哈希。
 *
 * @param {string} value
 * @returns {string} 十六进制摘要
 */
function sha256hex(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

/**
 * 常量时间比较两个 hex 字符串（长度不同直接判负）。
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean} 两值是否相等
 */
function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string')
    return false
  const ba = Buffer.from(a, 'hex')
  const bb = Buffer.from(b, 'hex')
  if (ba.length === 0 || ba.length !== bb.length)
    return false
  return crypto.timingSafeEqual(ba, bb)
}

module.exports = {
  USER_CODE_ALPHABET,
  randomToken,
  generateUserCode,
  normalizeUserCode,
  sha256hex,
  timingSafeEqualHex,
}
