/** Private account-api access-state proxy. */
'use strict'

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

module.exports = { assertActiveAccountForUid, getAccountAccessForUid }
