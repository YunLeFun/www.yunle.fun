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

  const collection = db.collection(MEMBERSHIPS_COLLECTION)
  if (typeof collection.doc === 'function') {
    const byId = await collection.doc(userId).get()
    const doc = firstDoc(byId?.data)
    if (doc && typeof doc === 'object' && (!doc.userId || doc.userId === userId))
      return { ...doc, _id: userId, userId: doc.userId || userId }
  }

  const { data } = await collection
    .where({ userId })
    .limit(10)
    .get()
  if (!Array.isArray(data) || data.length === 0)
    return null

  return data.find(item => item?._id === userId) || data[0]
}

module.exports = {
  MEMBERSHIPS_COLLECTION,
  readMembership,
}
