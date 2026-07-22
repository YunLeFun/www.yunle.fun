/** 受认证 account-api action 的统一访问判定与分发。 */

'use strict'

const { assertAccountActionAllowed, getAccountAccess } = require('./account-access')

async function dispatchAuthenticatedAction(db, {
  userId,
  action,
  handlers,
  now = Date.now(),
}) {
  await assertAccountActionAllowed(db, { userId, action, now })
  if (action === 'getAccountAccessStatus')
    return getAccountAccess(db, { userId, now })

  const handler = handlers?.[action]
  if (typeof handler !== 'function')
    throw new Error(`未知 action: ${action}`)
  return await handler()
}

module.exports = { dispatchAuthenticatedAction }
