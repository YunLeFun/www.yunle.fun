/** CloudBase persistence adapter for synthetic ticket issuance. */

'use strict'

const { TestLeaseMintError, validateMintContext } = require('./test-lease')

const COLLECTIONS = {
  identities: 'test_identities',
  leases: 'test_identity_leases',
  grants: 'test_login_grants',
  issuances: 'test_ticket_issuances',
}

function resultDocument(result) {
  if (!result)
    return null
  if (Array.isArray(result.data))
    return result.data[0] || null
  return result.data && typeof result.data === 'object' ? result.data : null
}

function assertDatabaseResult(result) {
  if (!result?.code)
    return
  const error = new Error(typeof result.message === 'string' ? result.message : 'database operation failed')
  error.code = result.code
  throw error
}

async function readDocument(database, collection, id, required = true) {
  const result = await database.collection(collection).doc(id).get()
  assertDatabaseResult(result)
  const value = resultDocument(result)
  if (!value && required)
    throw new TestLeaseMintError('broker_record_missing', `${collection} record is missing`)
  return value
}

async function updateDocument(database, collection, id, value) {
  const result = await database.collection(collection).doc(id).update(value)
  assertDatabaseResult(result)
  const updated = result?.updated ?? result?.modifiedCount
  if (updated !== undefined && Number(updated) <= 0)
    throw new TestLeaseMintError('broker_state_conflict', `${collection} update did not apply`, false)
}

async function loadContext(transaction, leaseId, issuanceId) {
  const issuance = await readDocument(transaction, COLLECTIONS.issuances, issuanceId)
  if (issuance.leaseId !== leaseId)
    throw new TestLeaseMintError('issuance_binding_invalid', 'Issuance belongs to another lease')
  const lease = await readDocument(transaction, COLLECTIONS.leases, leaseId)
  const [identity, grant] = await Promise.all([
    readDocument(transaction, COLLECTIONS.identities, lease.identityId),
    readDocument(transaction, COLLECTIONS.grants, issuance.grantId),
  ])
  return { issuance, lease, identity, grant }
}

function assertEscrow(issuance, now) {
  if (!issuance.ticketCiphertext
    || !issuance.ticketIv
    || !issuance.ticketTag
    || !Number.isSafeInteger(issuance.ticketExpiresAt)
    || issuance.ticketExpiresAt <= now
    || !Number.isSafeInteger(issuance.escrowExpiresAt)
    || issuance.escrowExpiresAt <= now) {
    throw new TestLeaseMintError('ticket_escrow_invalid', 'Ticket escrow is missing or expired')
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function createTestLeaseStore(db, options = {}) {
  const pollAttempts = Number.isInteger(options.pollAttempts) && options.pollAttempts > 0
    ? options.pollAttempts
    : 20
  const pollDelayMs = Number.isInteger(options.pollDelayMs) && options.pollDelayMs >= 0
    ? options.pollDelayMs
    : 100

  return {
    async claim({ leaseId, issuanceId, now }) {
      let outcome
      await db.runTransaction(async (transaction) => {
        const context = await loadContext(transaction, leaseId, issuanceId)
        const binding = validateMintContext(context, leaseId, issuanceId, now)
        const { issuance } = context
        if (issuance.status === 'minted' || issuance.status === 'delivered') {
          assertEscrow(issuance, now)
          outcome = { kind: 'minted' }
          return
        }
        if (issuance.status === 'minting') {
          outcome = { kind: 'minting' }
          return
        }
        if (issuance.status !== 'reserved')
          throw new TestLeaseMintError('issuance_unavailable', `Issuance is ${issuance.status}`)
        await updateDocument(transaction, COLLECTIONS.issuances, issuanceId, {
          status: 'minting',
          updatedAt: now,
        })
        outcome = { kind: 'claimed', ...binding }
      })
      if (!outcome)
        throw new TestLeaseMintError('broker_state_unavailable', 'Issuance transaction returned no result', false)
      return outcome
    },

    async waitForMinted({ leaseId, issuanceId }) {
      for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
        if (attempt > 0 && pollDelayMs > 0)
          await sleep(pollDelayMs)
        const issuance = await readDocument(db, COLLECTIONS.issuances, issuanceId)
        if (issuance.leaseId !== leaseId)
          throw new TestLeaseMintError('issuance_binding_invalid', 'Issuance belongs to another lease')
        if (issuance.status === 'minted' || issuance.status === 'delivered') {
          assertEscrow(issuance, Date.now())
          return { kind: 'minted' }
        }
        if (issuance.status !== 'minting')
          return { kind: issuance.status, reason: 'issuance_unavailable' }
      }
      return { kind: 'minting' }
    },

    async persistMinted(input) {
      await db.runTransaction(async (transaction) => {
        const issuance = await readDocument(transaction, COLLECTIONS.issuances, input.issuanceId)
        if (issuance.leaseId !== input.leaseId)
          throw new TestLeaseMintError('issuance_binding_invalid', 'Issuance belongs to another lease')
        if (issuance.status === 'minted' || issuance.status === 'delivered') {
          assertEscrow(issuance, input.now)
          return
        }
        if (issuance.status !== 'minting')
          throw new TestLeaseMintError('broker_state_conflict', 'Issuance is not minting', false)
        const lease = await readDocument(transaction, COLLECTIONS.leases, input.leaseId)
        if (lease.status !== 'active'
          || !Number.isSafeInteger(lease.expiresAt)
          || lease.expiresAt <= input.now
          || !Number.isSafeInteger(input.ticketExpiresAt)
          || input.ticketExpiresAt !== lease.expiresAt
          || !Number.isSafeInteger(issuance.escrowExpiresAt)
          || issuance.escrowExpiresAt <= input.now) {
          throw new TestLeaseMintError('lease_inactive', 'Lease became inactive before escrow persistence', false)
        }
        for (const field of ['ticketCiphertext', 'ticketIv', 'ticketTag']) {
          if (typeof input[field] !== 'string' || !input[field])
            throw new TestLeaseMintError('ticket_escrow_invalid', 'Ticket escrow is invalid', false)
        }
        await updateDocument(transaction, COLLECTIONS.issuances, input.issuanceId, {
          status: 'minted',
          ticketCiphertext: input.ticketCiphertext,
          ticketIv: input.ticketIv,
          ticketTag: input.ticketTag,
          ticketExpiresAt: input.ticketExpiresAt,
          updatedAt: input.now,
        })
      })
    },

    async markUncertain(input) {
      await transitionMinting(db, input, 'uncertain')
    },

    async markExpired(input) {
      await transitionMinting(db, input, 'expired')
    },
  }
}

async function transitionMinting(db, input, status) {
  await db.runTransaction(async (transaction) => {
    const issuance = await readDocument(transaction, COLLECTIONS.issuances, input.issuanceId)
    if (issuance.leaseId !== input.leaseId)
      throw new TestLeaseMintError('issuance_binding_invalid', 'Issuance belongs to another lease')
    if (issuance.status !== 'minting')
      return
    await updateDocument(transaction, COLLECTIONS.issuances, input.issuanceId, {
      status,
      updatedAt: input.now,
    })
  })
}

module.exports = {
  COLLECTIONS,
  createTestLeaseStore,
  resultDocument,
}
