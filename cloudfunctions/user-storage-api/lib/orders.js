/**
 * Minimal membership reader for user-storage-api.
 */

'use strict'

const MEMBERSHIPS_COLLECTION = 'user_memberships'

function firstDoc(data) {
  if (Array.isArray(data))
    return data[0] || null
  return data || null
}

async function readMembership(db, userId) {
  if (!userId)
    return null

  const { data } = await db
    .collection(MEMBERSHIPS_COLLECTION)
    .doc(userId)
    .get()
  return firstDoc(data)
}

module.exports = {
  MEMBERSHIPS_COLLECTION,
  readMembership,
}
