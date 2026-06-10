/**
 * App Store 服务端校验（封装 Apple 官方 @apple/app-store-server-library）。
 *
 * 安全模型：
 *   - 交易查询：客户端只上送 transactionId，服务端经 App Store Server API
 *     取得 signedTransactionInfo，再用 SignedDataVerifier 本地验证 JWS 证书链
 *     （锚定 lib/certs/ 下的 Apple 根证书）后才入账——双重保障；
 *   - Server Notifications V2：signedPayload 直接本地验签（verifyAndDecodeNotification），
 *     无需回查 API 即可杜绝伪造回调。
 *
 * 环境分流（Apple 官方推荐）：先查生产环境，TransactionIdNotFound 再回退沙盒——
 * 审核期间 Apple 用沙盒账号测试生产包，服务端必须同时接受两个环境。
 *
 * 依赖注入：clientFactory / verifierFactory 可在测试中替换，避免真实网络与证书链。
 *
 * SYNCED FILE: 修改此文件后，请执行 `pnpm sync:wxpay-lib`。
 */

'use strict'

const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const {
  AppStoreServerAPIClient,
  Environment,
  SignedDataVerifier,
} = require('@apple/app-store-server-library')

/** App Store Server API：交易不存在错误码（apiError） */
const API_ERROR_TRANSACTION_ID_NOT_FOUND = 4040010

/** 依次尝试的环境（生产优先） */
const ENVIRONMENTS = [Environment.PRODUCTION, Environment.SANDBOX]

let cachedRootCertificates = null

/** 读取打包在 lib/certs/ 下的 Apple 根证书（DER Buffer，进程内缓存） */
function loadAppleRootCertificates() {
  if (!cachedRootCertificates) {
    cachedRootCertificates = [
      'AppleIncRootCertificate.cer',
      'AppleRootCA-G2.cer',
      'AppleRootCA-G3.cer',
    ].map(name => readFileSync(join(__dirname, 'certs', name)))
  }
  return cachedRootCertificates
}

/**
 * 创建 App Store 校验服务。
 *
 * @param {object} config
 * @param {string} config.issuerId App Store Connect API Issuer ID
 * @param {string} config.keyId API Key ID
 * @param {string} config.privateKeyPem .p8 私钥内容（PEM）
 * @param {string} config.bundleId App 的 bundle ID
 * @param {number} [config.appAppleId] App Store 的 app Apple ID（生产环境验签通知必需）
 * @param {object} [deps] 测试注入
 * @param {(environment: string) => object} [deps.clientFactory] 返回带 getTransactionInfo 的客户端
 * @param {(environment: string) => object} [deps.verifierFactory] 返回 SignedDataVerifier 兼容对象
 */
function createAppStoreService(config, deps = {}) {
  const { issuerId, keyId, privateKeyPem, bundleId, appAppleId } = config
  if (!issuerId || !keyId || !privateKeyPem || !bundleId)
    throw new Error('createAppStoreService: issuerId / keyId / privateKeyPem / bundleId 均为必填')

  const clientFactory = deps.clientFactory
    || (environment => new AppStoreServerAPIClient(privateKeyPem, keyId, issuerId, bundleId, environment))
  const verifierFactory = deps.verifierFactory
    || (environment => new SignedDataVerifier(
      loadAppleRootCertificates(),
      true, // enableOnlineChecks：OCSP 在线吊销检查
      environment,
      bundleId,
      appAppleId,
    ))

  // 客户端 / 验签器按环境惰性创建并复用
  const clients = new Map()
  const verifiers = new Map()
  function clientFor(environment) {
    if (!clients.has(environment))
      clients.set(environment, clientFactory(environment))
    return clients.get(environment)
  }
  function verifierFor(environment) {
    if (!verifiers.has(environment))
      verifiers.set(environment, verifierFactory(environment))
    return verifiers.get(environment)
  }

  /**
   * 查询并本地验签交易（生产 → 沙盒回退）。
   *
   * @param {string} transactionId
   * @returns {Promise<{ payload: object, environment: string }>} payload 为验签后的交易内容
   * @throws 两个环境都查不到 / 鉴权失败 / 验签失败
   */
  async function getVerifiedTransaction(transactionId) {
    if (typeof transactionId !== 'string' || !/^\d+$/.test(transactionId))
      throw new Error('transactionId 非法')

    for (const environment of ENVIRONMENTS) {
      let response
      try {
        response = await clientFor(environment).getTransactionInfo(transactionId)
      }
      catch (err) {
        // 该环境无此交易 → 回退下一个环境
        if (err?.httpStatusCode === 404 || err?.apiError === API_ERROR_TRANSACTION_ID_NOT_FOUND)
          continue
        if (err?.httpStatusCode === 401)
          throw new Error('App Store Server API 鉴权失败，请检查 APPSTORE_* 配置')
        throw new Error(`App Store Server API 错误: ${err?.httpStatusCode || err?.message || err}`)
      }
      const payload = await verifierFor(environment)
        .verifyAndDecodeTransaction(response.signedTransactionInfo)
      return { payload, environment }
    }

    throw new Error(`交易不存在: ${transactionId}`)
  }

  /**
   * 本地验签 App Store Server Notification V2 的 signedPayload。
   *
   * 通知体自带环境信息但验签器须与之匹配，依次尝试生产 / 沙盒。
   *
   * @param {string} signedPayload
   * @returns {Promise<object>} 验签后的通知 payload（含 notificationType / data）
   * @throws 两个环境都验签失败（伪造或配置错误）
   */
  async function verifyNotification(signedPayload) {
    let lastError = null
    for (const environment of ENVIRONMENTS) {
      try {
        return await verifierFor(environment).verifyAndDecodeNotification(signedPayload)
      }
      catch (err) {
        lastError = err
      }
    }
    throw new Error(`通知验签失败: ${lastError?.message || lastError}`)
  }

  /**
   * 本地验签通知内嵌的 signedTransactionInfo。
   *
   * @param {string} signedTransactionInfo
   * @param {string} environment 通知 payload 中的环境（'Production' | 'Sandbox'）
   * @returns {Promise<object>}
   */
  async function verifyTransactionInfo(signedTransactionInfo, environment) {
    return verifierFor(environment).verifyAndDecodeTransaction(signedTransactionInfo)
  }

  return { getVerifiedTransaction, verifyNotification, verifyTransactionInfo }
}

/**
 * 校验交易 payload 是否可入账。
 *
 * @param {object} payload 验签后的交易 payload
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
  API_ERROR_TRANSACTION_ID_NOT_FOUND,
  ENVIRONMENTS,
  loadAppleRootCertificates,
  createAppStoreService,
  assertGrantablePayload,
}
