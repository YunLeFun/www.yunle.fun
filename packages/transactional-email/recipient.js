/** CloudBase Auth email resolution shared by transactional email senders. */

'use strict'

function responseData(response) {
  return response?.Data || response?.data || {}
}

function looksLikeEmail(value) {
  if (typeof value !== 'string' || /\s/.test(value))
    return false
  const at = value.indexOf('@')
  const dot = value.lastIndexOf('.')
  return at > 0 && at === value.lastIndexOf('@') && dot > at + 1 && dot < value.length - 1
}

function createRecipientResolver(manager, options = {}) {
  return async function resolveRecipient(userId) {
    const response = await manager.user.describeUserList({ uidList: [userId], pageNo: 1, pageSize: 2 })
    const data = responseData(response)
    const users = Array.isArray(data.UserList)
      ? data.UserList
      : Array.isArray(data.userList) ? data.userList : []
    if (users.length !== 1)
      return null
    const user = users[0]
    const resolvedUid = user?.Uid || user?.uid || user?.UserId || user?.userId
    if (options.requireUidMatch && resolvedUid !== userId)
      return null
    const status = user?.UserStatus ?? user?.userStatus ?? user?.Status ?? user?.status
    if (options.requireActive && status !== 'ACTIVE')
      return null
    const email = user?.Email || user?.email || ''
    const verified = user?.EmailVerified ?? user?.emailVerified ?? user?.email_verified
    if (!looksLikeEmail(email) || verified === false)
      return null
    if (options.requireVerified && verified !== true) {
      if (typeof options.verifyEmailIdentity !== 'function')
        return null
      try {
        if (await options.verifyEmailIdentity({ email, userId }) !== true)
          return null
      }
      catch {
        return null
      }
    }
    return email
  }
}

module.exports = { createRecipientResolver, looksLikeEmail, responseData }
