/**
 * Minimal membership helpers for user-storage-api.
 */

'use strict'

function isMembershipActive(expireAt, now) {
  if (typeof expireAt !== 'number' || !Number.isFinite(expireAt))
    return false
  return expireAt > now
}

module.exports = {
  isMembershipActive,
}
