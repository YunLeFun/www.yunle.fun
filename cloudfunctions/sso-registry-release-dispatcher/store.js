/** CloudBase NoSQL adapter for Registry release outbox dispatch. */

'use strict'

const OUTBOX = 'sso_registry_release_outbox'

function row(result) {
  if (Array.isArray(result?.data))
    return result.data[0] || null
  return result?.data && typeof result.data === 'object' ? result.data : null
}

function rows(result) {
  return Array.isArray(result?.data) ? result.data : []
}

function createDispatcherStore(database) {
  return {
    async listReady(now, limit = 10) {
      async function earliest(status, timeField) {
        const result = await database.collection(OUTBOX)
          .where({ status })
          .orderBy(timeField, 'asc')
          .limit(limit)
          .get()
        return rows(result)
      }
      const [pending, retry, dispatching] = await Promise.all([
        earliest('pending', 'nextAttemptAt'),
        earliest('retry', 'nextAttemptAt'),
        earliest('dispatching', 'leaseExpiresAt'),
      ])
      return [...pending, ...retry, ...dispatching]
        .filter(document => Number(
          document.status === 'dispatching' ? document.leaseExpiresAt : document.nextAttemptAt,
        ) <= now)
        .sort((left, right) => Number(
          left.status === 'dispatching' ? left.leaseExpiresAt : left.nextAttemptAt,
        ) - Number(
          right.status === 'dispatching' ? right.leaseExpiresAt : right.nextAttemptAt,
        ))
        .slice(0, limit)
        .map(document => ({ releaseIntentId: document._id, ...document }))
    },
    claim(releaseIntentId, lease) {
      return database.runTransaction(async (transaction) => {
        const document = row(await transaction.collection(OUTBOX).doc(releaseIntentId).get())
        const ready = document && ((['pending', 'retry'].includes(document.status)
          && document.nextAttemptAt <= lease.updatedAt)
        || (document.status === 'dispatching' && document.leaseExpiresAt <= lease.updatedAt))
        if (!ready)
          return null
        await transaction.collection(OUTBOX).doc(releaseIntentId).update({ status: 'dispatching', ...lease })
        return { releaseIntentId, ...document, status: 'dispatching', ...lease }
      })
    },
    markSent(releaseIntentId, leaseOwner, fields) {
      return database.runTransaction(async (transaction) => {
        const document = row(await transaction.collection(OUTBOX).doc(releaseIntentId).get())
        if (!document || document.status !== 'dispatching' || document.leaseOwner !== leaseOwner)
          return false
        await transaction.collection(OUTBOX).doc(releaseIntentId).update({ status: 'sent', ...fields })
        return true
      })
    },
    markFailed(releaseIntentId, leaseOwner, fields) {
      return database.runTransaction(async (transaction) => {
        const document = row(await transaction.collection(OUTBOX).doc(releaseIntentId).get())
        if (!document || document.status !== 'dispatching' || document.leaseOwner !== leaseOwner)
          return false
        await transaction.collection(OUTBOX).doc(releaseIntentId).update(fields)
        return true
      })
    },
  }
}

module.exports = { createDispatcherStore }
