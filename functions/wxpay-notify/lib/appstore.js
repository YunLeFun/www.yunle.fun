/**
 * App Store Server API 客户端 + JWS 解码（依赖注入式，便于单元测试）。
 *
 * 安全模型：
 *   - 客户端上送的 transactionId / jws 仅作为查询凭据，**绝不**直接作为入账依据；
 *   - 入账依据是通过 TLS 直连 Apple App Store Server API 拿到的
 *     signedTransactionInfo（传输信道可信，无需在本地校验 JWS 证书链，
 *     因此不引入 @apple/app-store-server-library 与 Apple 根证书文件）；
 *   - App Store Server Notifications 的 signedPayload 同理：先解码提取
 *     transactionId，再回查 Server API 确认，杜绝伪造回调。
 *
 * 环境分流（Apple 官方推荐）：先查生产环境，404 再回退沙盒——审核期间
 * Apple 用沙盒账号测试生产包，服务端必须同时接受两个环境。
 *
 * SYNCED FILE: 修改此文件后，请执行 `pnpm sync:wxpay-lib`。
 */

'use strict'

const { Buffer } = require('node:buffer')
const { createPrivateKey, sign } = require('node:crypto')

const APPSTORE_HOSTS = Object.freeze({
  Production: 'https://api.storekit.itunes.apple.com',
  Sandbox: 'https://api.storekit-sandbox.itunes.apple.com',
})

/** API 鉴权 JWT 有效期（秒），Apple 上限 20 分钟 */
const API_TOKEN_TTL_SECONDS = 600

function base64UrlEncode(input) {
  return Buffer.from(input).toString('base64url')
}

/**
 * 解码 JWS 的 payload 部分（**不校验签名**，调用方必须用 Server API 回查确认）。
 *
 * @param {string} jws
 * @returns {object}
 * @throws 格式非法时抛错
 */
function decodeJwsPayload(jws) {
  if (typeof jws !== 'string' || !jws)
    throw new Error('JWS 必须为非空字符串')
  const parts = jws.split('.')
  if (parts.length !== 3)
    throw new Error('JWS 格式错误')
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  }
  catch {
    throw new Error('JWS payload 解析失败')
  }
}

/**
 * 生成 App Store Server API 鉴权 JWT（ES256，用 node:crypto 实现，无第三方依赖）。
 *
 * @param {object} input
 * @param {string} input.issuerId App Store Connect API Issuer ID
 * @param {string} input.keyId API Key ID
 * @param {string} input.privateKeyPem .p8 私钥内容（PEM）
 * @param {string} input.bundleId App 的 bundle ID
 * @param {number} [input.now] 毫秒时间戳（测试注入用）
 * @returns {string}
 */
function buildApiToken({ issuerId, keyId, privateKeyPem, bundleId, now = Date.now() }) {
  if (!issuerId || !keyId || !privateKeyPem || !bundleId)
    throw new Error('buildApiToken: issuerId / keyId / privateKeyPem / bundleId 均为必填')
  const header = { alg: 'ES256', kid: keyId, typ: 'JWT' }
  const iat = Math.floor(now / 1000)
  const payload = {
    iss: issuerId,
    iat,
    exp: iat + API_TOKEN_TTL_SECONDS,
    aud: 'appstoreconnect-v1',
    bid: bundleId,
  }
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`
  const key = createPrivateKey(privateKeyPem)
  // JWT (JOSE) 要求 r||s 原始格式签名，而非 DER
  const signature = sign('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' })
  return `${signingInput}.${base64UrlEncode(signature)}`
}

/**
 * 向 Apple 查询交易信息（生产 → 沙盒回退），返回解码后的交易 payload。
 *
 * @param {object} input
 * @param {string} input.transactionId
 * @param {object} input.config { issuerId, keyId, privateKeyPem, bundleId }
 * @param {typeof fetch} [input.fetch] 测试注入
 * @returns {Promise<{ payload: object, environment: 'Production' | 'Sandbox' }>}
 * @throws 两个环境都查不到 / 鉴权失败 / 网络错误
 */
async function getTransactionInfo({ transactionId, config, fetch: httpFetch = fetch }) {
  if (typeof transactionId !== 'string' || !/^\d+$/.test(transactionId))
    throw new Error('transactionId 非法')
  const token = buildApiToken(config)

  for (const [environment, host] of Object.entries(APPSTORE_HOSTS)) {
    const res = await httpFetch(
      `${host}/inApps/v1/transactions/${encodeURIComponent(transactionId)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    if (res.status === 404) {
      // 该环境无此交易，回退下一个环境
      continue
    }
    if (res.status === 401)
      throw new Error('App Store Server API 鉴权失败，请检查 APPSTORE_* 配置')
    if (!res.ok)
      throw new Error(`App Store Server API 错误: HTTP ${res.status}`)
    const data = await res.json()
    const payload = decodeJwsPayload(data.signedTransactionInfo)
    return { payload, environment }
  }

  throw new Error(`交易不存在: ${transactionId}`)
}

/**
 * 校验交易 payload 是否可入账。
 *
 * @param {object} payload Server API 返回的交易 payload
 * @param {object} expect
 * @param {string} expect.bundleId
 * @returns {object} 原样返回 payload
 * @throws bundleId 不匹配 / 已退款
 */
function assertGrantablePayload(payload, { bundleId }) {
  if (payload.bundleId !== bundleId)
    throw new Error(`交易 bundleId 不匹配: ${payload.bundleId}`)
  if (payload.revocationDate)
    throw new Error('交易已被撤销/退款，不可入账')
  return payload
}

module.exports = {
  APPSTORE_HOSTS,
  decodeJwsPayload,
  buildApiToken,
  getTransactionInfo,
  assertGrantablePayload,
}
