/**
 * 账户中心代理：desktop-auth 验签拿到 uid 后，凭 serviceToken 转调既有 account-api 的
 * 内部服务接口（getAccountForUser / deductCoinForUser）。account-api 零改动。
 *
 * callAccountApi 注入：(data) => Promise<result>。index.js 里用
 *   (data) => app.callFunction({ name:'account-api', data }).then(r => r.result)
 * 装配；单测注入 fake，便于断言转调参数。
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

async function getAccountAccessForUid(callAccountApi, { serviceToken, userId }) {
  if (!serviceToken)
    throw new Error('内部服务鉴权未配置')
  return callAccountApi({ action: 'getAccountAccessForUser', serviceToken, userId })
}

function restrictionCode(state) {
  if (state === 'admin_banned')
    return 'account_banned'
  if (state === 'deletion_pending')
    return 'account_deletion_pending'
  if (state === 'deletion_finalizing')
    return 'account_deletion_finalizing'
  return 'account_access_unavailable'
}

async function assertActiveAccountForUid(callAccountApi, args) {
  const access = await getAccountAccessForUid(callAccountApi, args)
  if (access?.restricted === false && access.state === 'active')
    return access
  const error = new Error('账号当前不可执行该操作')
  error.code = restrictionCode(access?.state)
  error.state = access?.state || 'unavailable'
  error.access = access
  throw error
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

module.exports = {
  assertActiveAccountForUid,
  deductCoinForUid,
  getAccountAccessForUid,
  getAccountForUid,
}
