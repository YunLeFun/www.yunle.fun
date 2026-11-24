'use strict'

const PLAY_OWNERS = 'play_purchase_owners'

function readResult(result) {
  if (result?.code)
    throw new Error('Google Play 账号绑定数据库操作失败')
  return Array.isArray(result?.data) ? result.data[0] : result?.data
}

function ownerRef(db, accountMarker) {
  return db.collection(PLAY_OWNERS).doc(accountMarker.slice(0, 40))
}

async function registerPlayOwner(db, accountMarker, userId, now) {
  const result = await db.runTransaction(async (transaction) => {
    const ref = ownerRef(transaction, accountMarker)
    const stored = readResult(await ref.get())
    if (stored && (stored.accountMarker !== accountMarker || stored.userId !== userId))
      throw new Error('Google Play 购买账号绑定不一致')
    if (!stored)
      readResult(await ref.set({ accountMarker, userId, createdAt: now }))
  })
  readResult(result)
}

async function findPlayOwner(db, accountMarker) {
  if (typeof accountMarker !== 'string' || !/^[0-9a-f]{64}$/.test(accountMarker))
    return null
  const stored = readResult(await ownerRef(db, accountMarker).get())
  return stored?.accountMarker === accountMarker && typeof stored.userId === 'string' && stored.userId
    ? stored.userId
    : null
}

module.exports = { PLAY_OWNERS, findPlayOwner, registerPlayOwner }
