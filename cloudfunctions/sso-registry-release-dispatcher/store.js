/** CloudBase NoSQL adapter for Registry release outbox dispatch. */

'use strict'

const OUTBOX = 'sso_registry_release_outbox'

function row(result) {
  return Array.isArray(result?.data) ? result.data[0] || null : null
}

function rows(result) {
  return Array.isArray(result?.data) ? result.data : []
}

function createDispatcherStore(database) {
  const command = database.command
  return {
    async listReady(now, limit = 10) {
      const expired = await database.collection(OUTBOX)
        .where({ status: 'dispatching', leaseExpiresAt: command.lte(now) })
        .limit(limit)
        .get()
      const result = await database.collection(OUTBOX)
        .where({
          status: command.in(['pending', 'retry']),
          nextAttemptAt: command.lte(now),
        })
        .orderBy('nextAttemptAt', 'asc')
        .limit(limit)
        .get()
      const ready = [...rows(expired), ...rows(result)]
      return ready.slice(0, limit).map(document => ({ releaseIntentId: document._id, ...document }))
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
