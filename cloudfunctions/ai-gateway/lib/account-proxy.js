/**
 * 账户中心代理：ai-gateway 拿到登录 uid 后，凭 serviceToken 转调既有 account-api 的
 * 内部服务接口（getAccountForUser / deductCoinForUser）。account-api 零改动。
 *
 * 与 desktop-auth/lib/account-proxy.js 同形：callAccountApi 注入 (data)=>Promise<result>，
 * index.js 用 app.callFunction({ name:'account-api', data }).then(r=>r.result) 装配；
 * 单测注入 fake，便于断言转调参数。
 */

'use strict'

/**
 * 读账户全貌（只读，不产流水）。
 *
 * @param {(data:object)=>Promise<any>} callAccountApi
 * @param {{ serviceToken: string, userId: string }} args
 * @returns {Promise<{ coin: number, membership: object }>} 账户全貌（余额 + 会员）
 */
async function getAccountForUid(callAccountApi, { serviceToken, userId }) {
  if (!serviceToken)
    throw new Error('内部服务鉴权未配置')
  return callAccountApi({ action: 'getAccountForUser', serviceToken, userId })
}

/**
 * 按 uid 扣云币（幂等键 bizId）。
 *
 * @param {(data:object)=>Promise<any>} callAccountApi
 * @param {{ serviceToken, userId, appId, amount, bizId, meta? }} args
 * @returns {Promise<{ balance: number, deduped: boolean }>} 扣费后余额与是否幂等命中
 */
async function deductCoinForUid(callAccountApi, { serviceToken, userId, appId, amount, bizId, meta }) {
  if (!serviceToken)
    throw new Error('内部服务鉴权未配置')
  return callAccountApi({ action: 'deductCoinForUser', serviceToken, userId, appId, amount, bizId, meta })
}

/**
 * Synthetic billing uses a separate trusted action. The account service
 * revalidates the durable reservation and writes synthetic metadata itself;
 * caller-provided meta is intentionally not accepted here.
 */
async function deductSyntheticCoinForUid(callAccountApi, args) {
  if (!args.serviceToken)
    throw new Error('内部服务鉴权未配置')
  return callAccountApi({
    action: 'deductSyntheticCoinForUser',
    serviceToken: args.serviceToken,
    userId: args.userId,
    appId: args.appId,
    amount: args.amount,
    bizId: args.bizId,
    reservationId: args.reservationId,
    syntheticLeaseId: args.syntheticLeaseId,
    syntheticScopeId: args.syntheticScopeId,
  })
}

module.exports = { getAccountForUid, deductCoinForUid, deductSyntheticCoinForUid }
