/**
 * Minimal validation helpers for user-storage-api.
 */

'use strict'

const RE_APP_ID = /^[\w-]{1,32}$/

function assertAppId(appId) {
  if (typeof appId !== 'string' || !RE_APP_ID.test(appId))
    throw new Error(`无效 appId: ${appId}`)
  return appId
}

module.exports = {
  assertAppId,
}
