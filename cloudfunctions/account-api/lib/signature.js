/**
 * 微信支付 V3 签名与验签纯函数。
 *
 * 参考文档：
 * - 商户 API 证书签名：
 *   https://pay.weixin.qq.com/docs/merchant/development/interface-rules/signature-generation.html
 * - 平台证书验签：
 *   https://pay.weixin.qq.com/docs/merchant/development/interface-rules/signature-verification.html
 *
 * 设计原则：
 * - 所有函数都是纯函数，不依赖运行时环境，便于单元测试与跨函数复用。
 * - 不在内部读 process.env，敏感参数由调用方传入。
 *
 * SYNCED FILE: 修改此文件后，请执行 `pnpm sync:wxpay-lib` 将变更同步到 wxpay-notify。
 */

'use strict'

const crypto = require('node:crypto')

const RE_ESCAPE_NEWLINE = /\\n/g
const RE_PEM_BEGIN_PRIVATE = /-----BEGIN (?:RSA )?PRIVATE KEY-----/
const RE_PEM_END_PRIVATE = /-----END (?:RSA )?PRIVATE KEY-----/
const RE_WHITESPACE = /\s+/g

/**
 * 修复 PEM 私钥格式：
 * - 兼容控制台粘贴时 `\n` 被字面化的情况
 * - 兼容去掉换行只剩 base64 的单行情况
 * - 兼容 PKCS#1 (`RSA PRIVATE KEY`) 与 PKCS#8 (`PRIVATE KEY`) 头
 *
 * @param {string} raw 控制台/环境变量中读到的原始字符串
 * @returns {string} 标准多行 PEM
 */
function normalizePrivateKey(raw) {
  if (!raw || typeof raw !== 'string') {
    throw new TypeError('normalizePrivateKey: raw 必须为非空字符串')
  }
  const key = raw.replace(RE_ESCAPE_NEWLINE, '\n').trim()
  if (key.includes('\n'))
    return key
  const base64 = key
    .replace(RE_PEM_BEGIN_PRIVATE, '')
    .replace(RE_PEM_END_PRIVATE, '')
    .replace(RE_WHITESPACE, '')
  const lines = []
  for (let i = 0; i < base64.length; i += 64) {
    lines.push(base64.slice(i, i + 64))
  }
  return `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----`
}

/**
 * 商户 API 请求签名内容
 * @returns {string}
 */
function buildRequestSigningString({ method, urlPath, timestamp, nonce, body }) {
  return `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${body || ''}\n`
}

/**
 * 平台回调验签内容
 * @returns {string}
 */
function buildCallbackSigningString({ timestamp, nonce, body }) {
  return `${timestamp}\n${nonce}\n${body || ''}\n`
}

/**
 * JSAPI / 小程序支付签名内容
 * @returns {string}
 */
function buildJsapiSigningString({ appId, timestamp, nonce, packageStr }) {
  return `${appId}\n${timestamp}\n${nonce}\n${packageStr}\n`
}

/**
 * 用 RSA-SHA256 对内容做 base64 签名
 * @param {string} content 待签名串
 * @param {string} privateKey PEM 格式私钥（可未规范化）
 */
function signWithPrivateKey(content, privateKey) {
  return crypto
    .createSign('RSA-SHA256')
    .update(content)
    .sign(normalizePrivateKey(privateKey), 'base64')
}

/**
 * 生成商户 API 请求所需的 Authorization Header
 *
 * @param {object} input
 * @param {'GET'|'POST'|'PUT'|'DELETE'} input.method
 * @param {string} input.urlPath  例如 /v3/pay/transactions/native
 * @param {string} input.body     请求体字符串，无则空串
 * @param {string} input.mchId    商户号
 * @param {string} input.serialNo 商户证书序列号
 * @param {string} input.privateKey 商户 API 私钥
 * @param {string} input.timestamp 10 位秒级时间戳（字符串）
 * @param {string} input.nonceStr 32 位以内随机串
 * @returns {string} Authorization Header
 */
function buildAuthorizationHeader({
  method,
  urlPath,
  body,
  mchId,
  serialNo,
  privateKey,
  timestamp,
  nonceStr,
}) {
  if (!mchId || !serialNo || !privateKey) {
    throw new Error('微信支付商户配置缺失：mchId/serialNo/privateKey 必填')
  }
  const content = buildRequestSigningString({
    method,
    urlPath,
    timestamp,
    nonce: nonceStr,
    body,
  })
  const signature = signWithPrivateKey(content, privateKey)
  return `WECHATPAY2-SHA256-RSA2048 mchid="${mchId}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${serialNo}"`
}

/**
 * 解析平台证书配置环境变量
 *
 * 期望格式：JSON 对象，key 为证书序列号，value 为 PEM 字符串
 *   {"4DF3FA...": "-----BEGIN PUBLIC KEY-----\n..."}
 *
 * 也支持单证书简写：`SERIAL_NO|PEM` 用竖线分隔（便于控制台填写）
 *
 * @param {string|undefined} raw 环境变量原始值
 * @returns {Record<string, string>} 序列号 -> PEM 公钥
 */
function parsePlatformCertificates(raw) {
  if (!raw)
    return {}
  // 1. 尝试 JSON
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const result = {}
      for (const [serial, pem] of Object.entries(parsed)) {
        if (typeof pem === 'string' && serial)
          result[serial] = pem.replace(RE_ESCAPE_NEWLINE, '\n')
      }
      return result
    }
  }
  catch {
    // not JSON, try pipe-delimited
  }
  // 2. 尝试 SERIAL|PEM 形式
  const idx = raw.indexOf('|')
  if (idx > 0) {
    const serial = raw.slice(0, idx).trim()
    const pem = raw.slice(idx + 1).trim().replace(RE_ESCAPE_NEWLINE, '\n')
    if (serial && pem)
      return { [serial]: pem }
  }
  return {}
}

/**
 * 验证微信支付 V3 回调签名
 *
 * @param {object} input
 * @param {Record<string,string>} input.certificates serial -> PEM 公钥
 * @param {string} input.serial wechatpay-serial header
 * @param {string} input.timestamp wechatpay-timestamp header
 * @param {string} input.nonce wechatpay-nonce header
 * @param {string} input.signature wechatpay-signature header (base64)
 * @param {string} input.body 回调原始请求体（必须未被 JSON.parse 改动）
 * @param {number} [input.toleranceSeconds] 允许的时钟漂移秒数，0 表示不校验
 * @param {number} [input.nowSeconds] 当前时间戳，便于测试注入
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
function verifyCallbackSignature({
  certificates,
  serial,
  timestamp,
  nonce,
  signature,
  body,
  toleranceSeconds = 300,
  nowSeconds,
}) {
  if (!timestamp || !nonce || !signature || !serial) {
    return { ok: false, reason: 'missing-header' }
  }
  if (toleranceSeconds > 0) {
    const ts = Number(timestamp)
    const now = nowSeconds ?? Math.floor(Date.now() / 1000)
    if (!Number.isFinite(ts) || Math.abs(now - ts) > toleranceSeconds) {
      return { ok: false, reason: 'timestamp-out-of-tolerance' }
    }
  }
  const publicKey = certificates?.[serial]
  if (!publicKey) {
    return { ok: false, reason: 'unknown-serial' }
  }
  const content = buildCallbackSigningString({ timestamp, nonce, body })
  let verified = false
  try {
    verified = crypto
      .createVerify('RSA-SHA256')
      .update(content)
      .verify(publicKey, signature, 'base64')
  }
  catch (err) {
    return { ok: false, reason: `verify-error:${err.message}` }
  }
  return verified ? { ok: true } : { ok: false, reason: 'signature-mismatch' }
}

module.exports = {
  normalizePrivateKey,
  buildRequestSigningString,
  buildCallbackSigningString,
  buildJsapiSigningString,
  signWithPrivateKey,
  buildAuthorizationHeader,
  parsePlatformCertificates,
  verifyCallbackSignature,
}
