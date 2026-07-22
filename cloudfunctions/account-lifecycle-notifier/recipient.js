/** CloudBase Auth 已验证邮箱解析。 */

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

function createRecipientResolver(manager) {
  return async function resolveRecipient(userId) {
    const response = await manager.user.describeUserList({ uidList: [userId], pageNo: 1, pageSize: 1 })
    const data = responseData(response)
    const user = Array.isArray(data.UserList)
      ? data.UserList[0]
      : Array.isArray(data.userList) ? data.userList[0] : null
    const email = user?.Email || user?.email || ''
    const verified = user?.EmailVerified ?? user?.emailVerified ?? user?.email_verified
    if (verified === false || !looksLikeEmail(email))
      return null
    return email
  }
}

module.exports = { createRecipientResolver, looksLikeEmail, responseData }
