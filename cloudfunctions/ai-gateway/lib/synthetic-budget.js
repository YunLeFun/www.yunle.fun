/** Durable, transactional coin/model reservations for synthetic AI calls. */

'use strict'

const { Buffer } = require('node:buffer')
const crypto = require('node:crypto')

const COLLECTIONS = {
  audits: 'test_identity_audit_logs',
  coinTransactions: 'coin_transactions',
  daily: 'test_identity_usage_daily',
  identities: 'test_identities',
  leases: 'test_identity_leases',
  reservations: 'test_identity_coin_reservations',
}

class SyntheticBudgetError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'SyntheticBudgetError'
    this.code = code
  }
}

function stableId(namespace, ...parts) {
  return crypto.createHash('sha256')
    .update(JSON.stringify([namespace, ...parts]))
    .digest('hex')
    .slice(0, 24)
}

function reservationDocumentId(leaseId, bizId) {
  return `sir_${stableId('synthetic_ai_reservation', leaseId, bizId)}`
}

function syntheticCoinTransactionId(userId, bizId) {
  return stableId('coin_transaction', userId, 'consume', bizId)
}

function syntheticAuditDocumentId(reservationId, action, reasonCode) {
  return stableId('synthetic_ai_audit', reservationId, action, reasonCode)
}

function assertInternalReconcileToken(provided, expected) {
  if (typeof expected !== 'string' || expected.length < 32 || expected.length > 512)
    throw new SyntheticBudgetError('reconcile_not_configured', '预算对账内部令牌未配置')
  if (typeof provided !== 'string')
    throw new SyntheticBudgetError('reconcile_forbidden', '预算对账内部鉴权失败')
  const expectedBytes = Buffer.from(expected)
  const providedBytes = Buffer.from(provided)
  if (providedBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(providedBytes, expectedBytes))
    throw new SyntheticBudgetError('reconcile_forbidden', '预算对账内部鉴权失败')
}

function shanghaiDateKey(now) {
  return new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
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
    throw new SyntheticBudgetError('broker_record_missing', `${collection} record is missing`)
  return value
}

async function updateDocument(database, collection, id, value) {
  const result = await database.collection(collection).doc(id).update(value)
  assertDatabaseResult(result)
  const updated = result?.updated ?? result?.modifiedCount
  if (updated !== undefined && Number(updated) <= 0)
    throw new SyntheticBudgetError('broker_state_conflict', `${collection} update did not apply`)
}

async function setDocument(database, collection, id, value) {
  const { _id: _documentId, ...document } = value
  const result = await database.collection(collection).doc(id).set(document)
  assertDatabaseResult(result)
}

function assertNonNegative(value, label) {
  if (!Number.isInteger(value) || value < 0)
    throw new SyntheticBudgetError('budget_state_invalid', `${label} is invalid`)
  return value
}

async function loadActiveContext(transaction, input, now) {
  const claims = input.claims || {}
  const [identity, lease] = await Promise.all([
    readDocument(transaction, COLLECTIONS.identities, claims.identityId),
    readDocument(transaction, COLLECTIONS.leases, claims.leaseId),
  ])
  if (identity._id !== claims.identityId
    || identity.uid !== input.uid
    || input.identity?._id !== identity._id
    || input.identity?.uid !== identity.uid
    || identity.synthetic !== true
    || identity.status !== 'leased'
    || identity.activeLeaseId !== lease._id
    || !Number.isSafeInteger(identity.version)
    || identity.version < 1) {
    throw new SyntheticBudgetError('lease_inactive', 'Synthetic identity is no longer leased')
  }
  if (lease._id !== claims.leaseId
    || lease.identityId !== identity._id
    || lease.effectiveUid !== input.uid
    || lease.status !== 'active'
    || !Number.isSafeInteger(lease.expiresAt)
    || lease.expiresAt <= now) {
    throw new SyntheticBudgetError('lease_inactive', 'Synthetic lease is inactive')
  }
  const target = lease.target || {}
  if (target.platformAppId !== claims.platformAppId
    || target.serviceAudience !== claims.serviceAudience
    || (target.billingAppId || '') !== (claims.billingAppId || '')
    || claims.billingAppId !== input.billingAppId
    || !target.scopeIds?.includes(input.scopeId)
    || !claims.scopeIds?.includes(input.scopeId)
    || !target.allowedActions?.includes(input.action)
    || !claims.allowedActions?.includes(input.action)
    || lease.policySnapshot?.identityVersion !== claims.identityVersion
    || lease.policySnapshot?.registryVersion !== claims.registryVersion) {
    throw new SyntheticBudgetError('synthetic_forbidden', 'Synthetic target binding is invalid')
  }
  return { identity, lease }
}

function assertReservationBinding(reservation, input) {
  const claims = input.claims || {}
  if (!reservation
    || reservation._id !== input.reservationId
    || reservation.identityId !== claims.identityId
    || reservation.leaseId !== claims.leaseId
    || reservation.effectiveUid !== input.uid
    || reservation.billingAppId !== input.billingAppId
    || reservation.scopeId !== input.scopeId
    || reservation.action !== input.action
    || reservation.bizId !== input.bizId
    || reservation.amount !== input.amount) {
    throw new SyntheticBudgetError('reservation_binding_invalid', 'Synthetic reservation binding is invalid')
  }
}

function reservationOutcome(reservation) {
  if (reservation.status === 'reconcile_required')
    return { kind: 'reconcile_required' }
  if (reservation.status === 'reserved' && reservation.generationStatus === 'reserved')
    return { kind: 'reserved', reservationId: reservation._id }
  if (reservation.status === 'reserved' && reservation.generationStatus === 'generating')
    return { kind: 'in_progress' }
  if (reservation.status === 'released'
    && reservation.generationStatus === 'failed'
    && !reservation.billingStatus
    && !reservation.coinTransactionId) {
    return { kind: 'retryable' }
  }
  return { kind: 'already_processed' }
}

function createSyntheticBudgetStore(db) {
  return {
    async reserve(rawInput) {
      const input = normalizeInput(rawInput)
      const reservationId = reservationDocumentId(input.claims.leaseId, input.bizId)
      let outcome
      await db.runTransaction(async (transaction) => {
        const { identity, lease } = await loadActiveContext(transaction, input, input.now)
        const existing = await readDocument(transaction, COLLECTIONS.reservations, reservationId, false)
        if (existing) {
          assertReservationBinding(existing, { ...input, reservationId })
          const prior = reservationOutcome(existing)
          if (prior.kind !== 'retryable') {
            outcome = prior
            return
          }
        }

        const dateKey = existing?.dateKey ?? shanghaiDateKey(input.now)
        const dailyId = `${identity._id}:${dateKey}`
        const daily = await readDocument(transaction, COLLECTIONS.daily, dailyId)
        assertDailyBinding(daily, identity._id, dateKey)
        const usage = checkedUsage(lease.usage)
        const dailyUsage = checkedUsage(daily)
        const policy = lease.policySnapshot || {}
        const leaseCoinLimit = Math.min(
          assertNonNegative(lease.budget?.maxCoin, 'lease budget'),
          assertNonNegative(policy.maxCoinPerLease, 'lease coin policy'),
        )
        const exceeds = usage.coinSpent + usage.coinReserved + input.amount > leaseCoinLimit
          || dailyUsage.coinSpent + dailyUsage.coinReserved + input.amount > assertNonNegative(policy.maxCoinPerDay, 'daily coin policy')
          || usage.modelCallsStarted + usage.modelCallsReserved + 1 > assertPositiveLimit(policy.maxModelCallsPerLease, 'lease model policy')
          || dailyUsage.modelCallsStarted + dailyUsage.modelCallsReserved + 1 > assertPositiveLimit(policy.maxModelCallsPerDay, 'daily model policy')
        if (exceeds) {
          outcome = { kind: 'budget_exceeded' }
          return
        }

        const reservation = existing
          ? {
              ...existing,
              attemptCount: assertNonNegative(existing.attemptCount ?? 0, 'reservation attempt') + 1,
              generationStatus: 'reserved',
              status: 'reserved',
              updatedAt: input.now,
            }
          : {
              _id: reservationId,
              identityId: identity._id,
              leaseId: lease._id,
              effectiveUid: input.uid,
              billingAppId: input.billingAppId,
              scopeId: input.scopeId,
              action: input.action,
              bizId: input.bizId,
              amount: input.amount,
              dateKey,
              attemptCount: 0,
              generationStatus: 'reserved',
              status: 'reserved',
              createdAt: input.now,
              updatedAt: input.now,
            }
        if (existing) {
          await updateDocument(transaction, COLLECTIONS.reservations, reservationId, {
            attemptCount: reservation.attemptCount,
            generationStatus: reservation.generationStatus,
            status: reservation.status,
            updatedAt: reservation.updatedAt,
          })
        }
        else {
          await setDocument(transaction, COLLECTIONS.reservations, reservationId, reservation)
        }
        await updateDocument(transaction, COLLECTIONS.leases, lease._id, {
          usage: {
            ...lease.usage,
            coinReserved: usage.coinReserved + input.amount,
            modelCallsReserved: usage.modelCallsReserved + 1,
          },
          updatedAt: input.now,
        })
        await updateDocument(transaction, COLLECTIONS.daily, dailyId, {
          coinReserved: dailyUsage.coinReserved + input.amount,
          modelCallsReserved: dailyUsage.modelCallsReserved + 1,
          version: assertNonNegative(daily.version, 'daily version') + 1,
          updatedAt: input.now,
        })
        await writeAudit(transaction, 'budget.reserve', 'reserved', reservation, lease, input.now)
        outcome = { kind: 'reserved', reservationId }
      })
      return requireOutcome(outcome)
    },

    async start(rawInput) {
      const input = normalizeStateInput(rawInput)
      let outcome
      await db.runTransaction(async (transaction) => {
        const reservation = await readDocument(transaction, COLLECTIONS.reservations, input.reservationId)
        assertReservationBinding(reservation, input)
        const prior = reservationOutcome(reservation)
        if (prior.kind !== 'reserved') {
          outcome = prior
          return
        }
        let context
        try {
          context = await loadActiveContext(transaction, input, input.now)
        }
        catch (error) {
          if (error instanceof SyntheticBudgetError) {
            await releaseUnstarted(transaction, reservation, input.now)
            outcome = { kind: 'lease_inactive' }
            return
          }
          throw error
        }
        const { lease } = context
        const daily = await readDocument(transaction, COLLECTIONS.daily, `${reservation.identityId}:${reservation.dateKey}`)
        const usage = checkedUsage(lease.usage)
        const dailyUsage = checkedUsage(daily)
        if (usage.modelCallsReserved < 1 || dailyUsage.modelCallsReserved < 1)
          throw new SyntheticBudgetError('budget_state_invalid', 'Reserved model call counter is missing')
        await updateDocument(transaction, COLLECTIONS.reservations, reservation._id, {
          generationStatus: 'generating',
          modelStartedAt: input.now,
          updatedAt: input.now,
        })
        await updateDocument(transaction, COLLECTIONS.leases, lease._id, {
          usage: {
            ...lease.usage,
            modelCallsReserved: usage.modelCallsReserved - 1,
            modelCallsStarted: usage.modelCallsStarted + 1,
          },
          updatedAt: input.now,
        })
        await updateDocument(transaction, COLLECTIONS.daily, daily._id, {
          modelCallsReserved: dailyUsage.modelCallsReserved - 1,
          modelCallsStarted: dailyUsage.modelCallsStarted + 1,
          version: assertNonNegative(daily.version, 'daily version') + 1,
          updatedAt: input.now,
        })
        await writeAudit(transaction, 'model.start', 'started', reservation, lease, input.now)
        outcome = { kind: 'started' }
      })
      return requireOutcome(outcome)
    },

    async failGeneration(rawInput) {
      const input = normalizeStateInput(rawInput)
      await finishGeneration(db, input, false)
    },

    async succeedGeneration(rawInput) {
      const input = normalizeStateInput(rawInput)
      let outcome
      await db.runTransaction(async (transaction) => {
        const reservation = await readDocument(transaction, COLLECTIONS.reservations, input.reservationId)
        assertReservationBinding(reservation, input)
        if (reservation.status !== 'reserved' || reservation.generationStatus !== 'generating') {
          outcome = reservationOutcome(reservation)
          return
        }
        let lease
        try {
          lease = (await loadActiveContext(transaction, input, input.now)).lease
        }
        catch (error) {
          if (!(error instanceof SyntheticBudgetError))
            throw error
          await releaseStartedCoin(transaction, reservation, input.now, 'succeeded', 'lease-inactive')
          outcome = { kind: 'lease_inactive' }
          return
        }
        await updateDocument(transaction, COLLECTIONS.reservations, reservation._id, {
          generationStatus: 'succeeded',
          modelFinishedAt: input.now,
          updatedAt: input.now,
        })
        await writeAudit(transaction, 'model.finish', 'succeeded', reservation, lease, input.now)
        outcome = { kind: 'succeeded' }
      })
      return requireOutcome(outcome)
    },

    async settle(rawInput) {
      const input = normalizeStateInput(rawInput)
      await db.runTransaction(async (transaction) => {
        const reservation = await readDocument(transaction, COLLECTIONS.reservations, input.reservationId)
        assertReservationBinding(reservation, input)
        if (reservation.status === 'settled')
          return
        if (reservation.status !== 'reserved' || reservation.generationStatus !== 'succeeded')
          throw new SyntheticBudgetError('reservation_not_settleable', 'Reservation is not settleable')
        await settleReservedCoin(
          transaction,
          reservation,
          input.now,
          typeof rawInput.coinTransactionId === 'string' ? rawInput.coinTransactionId : undefined,
          'budget.settle',
        )
      })
    },

    async markReconcile(rawInput) {
      const input = normalizeStateInput(rawInput)
      await db.runTransaction(async (transaction) => {
        const reservation = await readDocument(transaction, COLLECTIONS.reservations, input.reservationId)
        assertReservationBinding(reservation, input)
        if (reservation.status === 'settled' || reservation.status === 'released' || reservation.status === 'reconcile_required')
          return
        const lease = await readDocument(transaction, COLLECTIONS.leases, reservation.leaseId)
        await updateDocument(transaction, COLLECTIONS.reservations, reservation._id, {
          status: 'reconcile_required',
          updatedAt: input.now,
        })
        await writeAudit(transaction, 'budget.reconcile', 'required', reservation, lease, input.now, 'failed')
      })
    },

    async reconcile(rawInput = {}) {
      const now = Number.isSafeInteger(rawInput.now) ? rawInput.now : Date.now()
      const staleAfterMs = Number.isSafeInteger(rawInput.staleAfterMs) ? rawInput.staleAfterMs : 120_000
      const limit = Number.isSafeInteger(rawInput.limit) ? rawInput.limit : 100
      if (now < 0 || staleAfterMs < 30_000 || staleAfterMs > 3_600_000 || limit < 1 || limit > 200)
        throw new SyntheticBudgetError('reconcile_input_invalid', 'Synthetic reconciliation input is invalid')

      const cutoff = now - staleAfterMs
      const candidates = await listReconciliationCandidates(db, cutoff, limit)
      const result = { scanned: candidates.length, settled: 0, released: 0, manual: 0, skipped: 0, errors: 0 }
      for (const candidate of candidates) {
        try {
          const outcome = await reconcileReservation(db, candidate._id, cutoff, now)
          result[outcome] += 1
        }
        catch {
          result.errors += 1
        }
      }
      return { ...result, ...await rebuildRecentDailyUsage(db, now) }
    },
  }
}

async function rebuildRecentDailyUsage(db, now) {
  const dateKeys = [...new Set([shanghaiDateKey(now), shanghaiDateKey(now - 86_400_000)])]
  const dailyRecords = (await Promise.all(dateKeys.map(async dateKey => await listBoundedDocuments(
    db,
    COLLECTIONS.daily,
    { dateKey },
    200,
    'Daily usage',
  )))).flat()
  const result = { dailyScanned: dailyRecords.length, dailyRepaired: 0, dailySkipped: 0 }
  for (const snapshot of dailyRecords) {
    const expected = await reconstructDailyUsage(db, snapshot, snapshot.dateKey, now)
    if (!expected) {
      result.dailySkipped += 1
      continue
    }
    const outcome = await repairDailyUsage(db, snapshot, expected, now)
    result[outcome] += 1
  }
  return result
}

async function reconstructDailyUsage(db, daily, dateKey, now) {
  assertDailyBinding(daily, daily.identityId, dateKey)
  checkedCompleteDailyUsage(daily)
  assertNonNegative(daily.version, 'daily version')
  const identity = await readDocument(db, COLLECTIONS.identities, daily.identityId)
  if (identity.synthetic !== true || typeof identity.uid !== 'string' || !identity.uid)
    throw new SyntheticBudgetError('daily_usage_invalid', 'Daily usage identity binding is invalid')

  const reservations = await listBoundedDocuments(
    db,
    COLLECTIONS.reservations,
    { identityId: daily.identityId, dateKey },
    200,
    'Daily reservation',
  )
  let coinReserved = 0
  let coinSpent = 0
  let modelCallsReserved = 0
  let modelCallsStarted = 0
  for (const reservation of reservations) {
    assertDailyReservation(reservation, daily.identityId, dateKey)
    const transactionId = syntheticCoinTransactionId(reservation.effectiveUid, reservation.bizId)
    const coinTransaction = await readDocument(db, COLLECTIONS.coinTransactions, transactionId, false)
    if (coinTransaction) {
      assertSyntheticCoinTransaction(coinTransaction, reservation, transactionId)
      if (reservation.status !== 'settled')
        return null
      coinSpent += reservation.amount
    }
    else if (reservation.status === 'settled') {
      throw new SyntheticBudgetError('reconcile_transaction_conflict', 'Settled reservation is missing its coin transaction')
    }
    else if (reservation.status === 'reserved' || reservation.status === 'reconcile_required') {
      coinReserved += reservation.amount
    }

    if (reservation.status === 'reserved' && reservation.generationStatus === 'reserved')
      modelCallsReserved += 1
    if (Number.isSafeInteger(reservation.modelStartedAt))
      modelCallsStarted += 1
  }

  const { start, end } = shanghaiDateBounds(dateKey)
  const audits = await listBoundedDocuments(
    db,
    COLLECTIONS.audits,
    {
      effectiveUid: identity.uid,
      // A slot reserved immediately before midnight may be released by a
      // delayed signer/sweep after midnight. Include facts through this sweep
      // while still attributing reserve/create events by their Shanghai day.
      createdAt: dateRange(db, start - 120_000, Math.max(end + 120_000, now + 1)),
    },
    999,
    'Daily audit',
  )
  const leaseIds = new Set()
  const reservedIssuances = new Set()
  const releasedIssuances = new Set()
  const mintedIssuances = new Set()
  for (const audit of audits) {
    if (!Number.isSafeInteger(audit.createdAt) || typeof audit.action !== 'string'
      || typeof audit.traceId !== 'string' || audit.identityId !== daily.identityId) {
      throw new SyntheticBudgetError('daily_usage_invalid', 'Daily audit fact is invalid')
    }
    const eventDateKey = shanghaiDateKey(audit.createdAt)
    if ((audit.action === 'lease.create' || audit.action === 'lease.approve')
      && audit.outcome === 'succeeded' && eventDateKey === dateKey && typeof audit.leaseId === 'string') {
      leaseIds.add(audit.leaseId)
    }
    if (audit.action === 'grant.exchange.reserve'
      && audit.outcome === 'succeeded' && eventDateKey === dateKey) {
      reservedIssuances.add(audit.traceId)
    }
    if (audit.action === 'grant.exchange.mint' && audit.traceId.endsWith(':expired'))
      releasedIssuances.add(audit.traceId.slice(0, -':expired'.length))
    if (audit.action === 'ticket.reconcile'
      && (audit.reasonCode === 'signer-not-claimed' || audit.detail?.status === 'expired')) {
      releasedIssuances.add(audit.traceId)
    }
    if (audit.action === 'grant.exchange.deliver' && audit.outcome === 'succeeded'
      && audit.traceId.endsWith(':delivered')) {
      mintedIssuances.add(audit.traceId.slice(0, -':delivered'.length))
    }
  }

  let ticketSlotsReserved = 0
  let ticketsMinted = 0
  for (const issuanceId of reservedIssuances) {
    if (!releasedIssuances.has(issuanceId))
      ticketSlotsReserved += 1
    if (mintedIssuances.has(issuanceId))
      ticketsMinted += 1
  }
  return {
    coinReserved,
    coinSpent,
    leasesCreated: leaseIds.size,
    modelCallsReserved,
    modelCallsStarted,
    ticketSlotsReserved,
    ticketsMinted,
  }
}

async function repairDailyUsage(db, snapshot, expected, now) {
  let outcome = 'dailySkipped'
  await db.runTransaction(async (transaction) => {
    const current = await readDocument(transaction, COLLECTIONS.daily, snapshot._id)
    assertDailyBinding(current, snapshot.identityId, snapshot.dateKey)
    const currentUsage = checkedCompleteDailyUsage(current)
    if (assertNonNegative(current.version, 'daily version') !== snapshot.version)
      return
    const changed = Object.entries(expected).some(([key, value]) => currentUsage[key] !== value)
    if (!changed)
      return
    const identity = await readDocument(transaction, COLLECTIONS.identities, current.identityId)
    if (identity.synthetic !== true || typeof identity.uid !== 'string' || !identity.uid)
      throw new SyntheticBudgetError('daily_usage_invalid', 'Daily usage identity binding is invalid')
    await updateDocument(transaction, COLLECTIONS.daily, current._id, {
      ...expected,
      version: current.version + 1,
      updatedAt: now,
    })
    const auditId = stableId('daily_usage_repair', current._id, current.version)
    await persistImmutableAudit(transaction, {
      _id: auditId,
      action: 'daily-usage.reconcile',
      outcome: 'succeeded',
      reasonCode: 'drift-repaired',
      principal: { type: 'system', service: 'ai-gateway' },
      effectiveUid: identity.uid,
      identityId: current.identityId,
      identityVersion: identity.version,
      traceId: current._id,
      detail: { previousVersion: current.version, ...expected },
      createdAt: now,
    })
    outcome = 'dailyRepaired'
  })
  return outcome
}

async function listBoundedDocuments(db, collection, filters, maximum, label) {
  const result = await db.collection(collection).where(filters).limit(maximum + 1).get()
  assertDatabaseResult(result)
  if (!Array.isArray(result?.data))
    throw new SyntheticBudgetError('reconcile_database_invalid', `${label} query returned invalid data`)
  if (result.data.length > maximum)
    throw new SyntheticBudgetError('reconcile_source_limit', `${label} query exceeded its safe bound`)
  return result.data
}

function shanghaiDateBounds(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey))
    throw new SyntheticBudgetError('daily_usage_invalid', 'Daily usage date is invalid')
  const start = Date.parse(`${dateKey}T00:00:00+08:00`)
  if (!Number.isSafeInteger(start))
    throw new SyntheticBudgetError('daily_usage_invalid', 'Daily usage date is invalid')
  return { start, end: start + 86_400_000 }
}

function dateRange(db, start, end) {
  if (!db?.command || typeof db.command.gte !== 'function' || typeof db.command.lt !== 'function')
    throw new SyntheticBudgetError('reconcile_database_invalid', 'Database range command is unavailable')
  const lower = db.command.gte(start)
  if (!lower || typeof lower.and !== 'function')
    throw new SyntheticBudgetError('reconcile_database_invalid', 'Database range command is unavailable')
  return lower.and(db.command.lt(end))
}

function assertDailyReservation(reservation, identityId, dateKey) {
  if (!reservation || typeof reservation._id !== 'string'
    || reservation.identityId !== identityId
    || reservation.dateKey !== dateKey
    || typeof reservation.effectiveUid !== 'string'
    || typeof reservation.bizId !== 'string'
    || !Number.isInteger(reservation.amount)
    || reservation.amount <= 0
    || typeof reservation.status !== 'string'
    || typeof reservation.generationStatus !== 'string') {
    throw new SyntheticBudgetError('daily_usage_invalid', 'Daily reservation fact is invalid')
  }
}

async function listReconciliationCandidates(db, cutoff, limit) {
  if (!db?.command || typeof db.command.lte !== 'function')
    throw new SyntheticBudgetError('reconcile_database_invalid', 'Database comparison command is unavailable')
  const candidates = []
  for (const status of ['reconcile_required', 'reserved']) {
    const remaining = limit - candidates.length
    if (remaining <= 0)
      break
    const result = await db.collection(COLLECTIONS.reservations)
      .where({ status, updatedAt: db.command.lte(cutoff) })
      .orderBy('updatedAt', 'asc')
      .limit(remaining)
      .get()
    assertDatabaseResult(result)
    if (!Array.isArray(result?.data))
      throw new SyntheticBudgetError('reconcile_database_invalid', 'Reservation query returned invalid data')
    for (const value of result.data) {
      if (value && typeof value._id === 'string' && !candidates.some(item => item._id === value._id))
        candidates.push(value)
    }
  }
  return candidates
}

async function reconcileReservation(db, reservationId, cutoff, now) {
  let outcome = 'skipped'
  await db.runTransaction(async (transaction) => {
    const reservation = await readDocument(transaction, COLLECTIONS.reservations, reservationId)
    if (reservation.status === 'settled' || reservation.status === 'released') {
      outcome = 'skipped'
      return
    }
    if ((reservation.status !== 'reserved' && reservation.status !== 'reconcile_required')
      || !Number.isFinite(reservation.updatedAt)
      || reservation.updatedAt > cutoff) {
      outcome = 'skipped'
      return
    }

    const transactionId = syntheticCoinTransactionId(reservation.effectiveUid, reservation.bizId)
    const coinTransaction = await readDocument(
      transaction,
      COLLECTIONS.coinTransactions,
      transactionId,
      false,
    )
    if (coinTransaction) {
      assertSyntheticCoinTransaction(coinTransaction, reservation, transactionId)
      if (reservation.generationStatus !== 'succeeded')
        throw new SyntheticBudgetError('reconcile_state_invalid', 'Charged reservation did not succeed generation')
      await settleReservedCoin(
        transaction,
        reservation,
        now,
        transactionId,
        'budget.reconcile.settle',
      )
      outcome = 'settled'
      return
    }

    if (reservation.billingStatus === 'charged' || reservation.coinTransactionId) {
      const lease = await readDocument(transaction, COLLECTIONS.leases, reservation.leaseId)
      if (reservation.status !== 'reconcile_required') {
        await updateDocument(transaction, COLLECTIONS.reservations, reservation._id, {
          status: 'reconcile_required',
          updatedAt: now,
        })
        await writeAudit(transaction, 'budget.reconcile', 'transaction-missing', reservation, lease, now, 'failed')
      }
      outcome = 'manual'
      return
    }

    if (reservation.generationStatus === 'reserved') {
      await releaseUnstarted(transaction, reservation, now)
      outcome = 'released'
      return
    }
    if (['generating', 'succeeded', 'failed', 'unknown'].includes(reservation.generationStatus)) {
      const generationStatus = reservation.generationStatus === 'generating'
        ? 'unknown'
        : reservation.generationStatus
      await releaseStartedCoin(transaction, reservation, now, generationStatus, 'reconciled-without-charge')
      outcome = 'released'
      return
    }
    throw new SyntheticBudgetError('reconcile_state_invalid', 'Reservation generation state is invalid')
  })
  return outcome
}

function assertSyntheticCoinTransaction(transaction, reservation, transactionId) {
  const meta = transaction.meta || {}
  if (transaction._id !== transactionId
    || transaction.userId !== reservation.effectiveUid
    || transaction.appId !== reservation.billingAppId
    || transaction.type !== 'consume'
    || transaction.amount !== -reservation.amount
    || transaction.refId !== reservation.bizId
    || meta.synthetic !== true
    || meta.syntheticLeaseId !== reservation.leaseId
    || meta.syntheticReservationId !== reservation._id
    || meta.syntheticScopeId !== reservation.scopeId) {
    throw new SyntheticBudgetError('reconcile_transaction_conflict', 'Synthetic coin transaction binding is invalid')
  }
}

async function settleReservedCoin(transaction, reservation, now, coinTransactionId, auditAction) {
  const lease = await readDocument(transaction, COLLECTIONS.leases, reservation.leaseId)
  const daily = await readDocument(transaction, COLLECTIONS.daily, `${reservation.identityId}:${reservation.dateKey}`)
  const usage = checkedUsage(lease.usage)
  const dailyUsage = checkedUsage(daily)
  if (usage.coinReserved < reservation.amount || dailyUsage.coinReserved < reservation.amount)
    throw new SyntheticBudgetError('budget_state_invalid', 'Reserved coin counter is missing')
  await updateDocument(transaction, COLLECTIONS.reservations, reservation._id, {
    status: 'settled',
    coinTransactionId,
    updatedAt: now,
  })
  await updateDocument(transaction, COLLECTIONS.leases, lease._id, {
    usage: {
      ...lease.usage,
      coinReserved: usage.coinReserved - reservation.amount,
      coinSpent: usage.coinSpent + reservation.amount,
    },
    updatedAt: now,
  })
  await updateDocument(transaction, COLLECTIONS.daily, daily._id, {
    coinReserved: dailyUsage.coinReserved - reservation.amount,
    coinSpent: dailyUsage.coinSpent + reservation.amount,
    version: assertNonNegative(daily.version, 'daily version') + 1,
    updatedAt: now,
  })
  await writeAudit(transaction, auditAction, 'settled', reservation, lease, now)
}

async function finishGeneration(db, input, succeeded) {
  await db.runTransaction(async (transaction) => {
    const reservation = await readDocument(transaction, COLLECTIONS.reservations, input.reservationId)
    assertReservationBinding(reservation, input)
    if (reservation.status !== 'reserved' || reservation.generationStatus !== 'generating')
      return
    await releaseStartedCoin(transaction, reservation, input.now, succeeded ? 'succeeded' : 'failed', succeeded ? 'succeeded' : 'model-failed')
  })
}

async function releaseUnstarted(transaction, reservation, now) {
  const lease = await readDocument(transaction, COLLECTIONS.leases, reservation.leaseId)
  const daily = await readDocument(transaction, COLLECTIONS.daily, `${reservation.identityId}:${reservation.dateKey}`)
  const usage = checkedUsage(lease.usage)
  const dailyUsage = checkedUsage(daily)
  if (usage.coinReserved < reservation.amount || usage.modelCallsReserved < 1
    || dailyUsage.coinReserved < reservation.amount || dailyUsage.modelCallsReserved < 1) {
    throw new SyntheticBudgetError('budget_state_invalid', 'Unstarted reservation counters are missing')
  }
  await updateDocument(transaction, COLLECTIONS.reservations, reservation._id, {
    generationStatus: 'failed',
    status: 'released',
    modelFinishedAt: now,
    updatedAt: now,
  })
  await updateDocument(transaction, COLLECTIONS.leases, lease._id, {
    usage: {
      ...lease.usage,
      coinReserved: usage.coinReserved - reservation.amount,
      modelCallsReserved: usage.modelCallsReserved - 1,
    },
    updatedAt: now,
  })
  await updateDocument(transaction, COLLECTIONS.daily, daily._id, {
    coinReserved: dailyUsage.coinReserved - reservation.amount,
    modelCallsReserved: dailyUsage.modelCallsReserved - 1,
    version: assertNonNegative(daily.version, 'daily version') + 1,
    updatedAt: now,
  })
  await writeAudit(transaction, 'budget.release', 'lease-inactive', reservation, lease, now, 'denied')
}

async function releaseStartedCoin(transaction, reservation, now, generationStatus, reasonCode) {
  const lease = await readDocument(transaction, COLLECTIONS.leases, reservation.leaseId)
  const daily = await readDocument(transaction, COLLECTIONS.daily, `${reservation.identityId}:${reservation.dateKey}`)
  const usage = checkedUsage(lease.usage)
  const dailyUsage = checkedUsage(daily)
  if (usage.coinReserved < reservation.amount || dailyUsage.coinReserved < reservation.amount)
    throw new SyntheticBudgetError('budget_state_invalid', 'Started reservation coin is missing')
  await updateDocument(transaction, COLLECTIONS.reservations, reservation._id, {
    generationStatus,
    status: 'released',
    modelFinishedAt: now,
    updatedAt: now,
  })
  await updateDocument(transaction, COLLECTIONS.leases, lease._id, {
    usage: { ...lease.usage, coinReserved: usage.coinReserved - reservation.amount },
    updatedAt: now,
  })
  await updateDocument(transaction, COLLECTIONS.daily, daily._id, {
    coinReserved: dailyUsage.coinReserved - reservation.amount,
    version: assertNonNegative(daily.version, 'daily version') + 1,
    updatedAt: now,
  })
  await writeAudit(transaction, 'budget.release', reasonCode, reservation, lease, now, generationStatus === 'failed' ? 'failed' : 'denied')
}

function normalizeInput(input) {
  if (!input || typeof input !== 'object'
    || !input.claims
    || typeof input.bizId !== 'string'
    || !/^[\w:-]{1,128}$/.test(input.bizId)
    || typeof input.action !== 'string'
    || typeof input.scopeId !== 'string'
    || typeof input.billingAppId !== 'string'
    || !Number.isInteger(input.amount)
    || input.amount <= 0) {
    throw new SyntheticBudgetError('reservation_input_invalid', 'Synthetic reservation input is invalid')
  }
  return { ...input, now: Number.isFinite(input.now) ? input.now : Date.now() }
}

function normalizeStateInput(input) {
  const normalized = normalizeInput(input)
  const expectedId = reservationDocumentId(normalized.claims.leaseId, normalized.bizId)
  if (input.reservationId !== expectedId)
    throw new SyntheticBudgetError('reservation_binding_invalid', 'Reservation ID is invalid')
  return normalized
}

function checkedUsage(value) {
  return {
    coinReserved: assertNonNegative(value?.coinReserved, 'coinReserved'),
    coinSpent: assertNonNegative(value?.coinSpent, 'coinSpent'),
    modelCallsReserved: assertNonNegative(value?.modelCallsReserved, 'modelCallsReserved'),
    modelCallsStarted: assertNonNegative(value?.modelCallsStarted, 'modelCallsStarted'),
  }
}

function checkedCompleteDailyUsage(value) {
  return {
    ...checkedUsage(value),
    leasesCreated: assertNonNegative(value?.leasesCreated, 'leasesCreated'),
    ticketSlotsReserved: assertNonNegative(value?.ticketSlotsReserved, 'ticketSlotsReserved'),
    ticketsMinted: assertNonNegative(value?.ticketsMinted, 'ticketsMinted'),
  }
}

function assertPositiveLimit(value, label) {
  if (!Number.isInteger(value) || value <= 0)
    throw new SyntheticBudgetError('budget_policy_invalid', `${label} is invalid`)
  return value
}

function assertDailyBinding(daily, identityId, dateKey) {
  if (daily._id !== `${identityId}:${dateKey}`
    || daily.identityId !== identityId
    || daily.dateKey !== dateKey
    || daily.timezone !== 'Asia/Shanghai') {
    throw new SyntheticBudgetError('daily_usage_invalid', 'Daily usage binding is invalid')
  }
}

async function writeAudit(transaction, action, reasonCode, reservation, lease, now, outcome = 'succeeded') {
  if (!lease?.principal || typeof lease.principal !== 'object'
    || !lease?.approvedBy || typeof lease.approvedBy !== 'object') {
    throw new SyntheticBudgetError('audit_context_invalid', 'Synthetic lease audit principals are invalid')
  }
  const attemptCount = assertNonNegative(reservation.attemptCount ?? 0, 'reservation attempt')
  const eventKey = attemptCount > 0 ? `${reasonCode}:attempt-${attemptCount}` : reasonCode
  const id = syntheticAuditDocumentId(reservation._id, action, eventKey)
  const audit = {
    _id: id,
    action,
    outcome,
    reasonCode,
    principal: lease.principal,
    approvedBy: lease.approvedBy,
    effectiveUid: reservation.effectiveUid,
    identityId: reservation.identityId,
    leaseId: reservation.leaseId,
    platformAppId: lease.target?.platformAppId,
    serviceAudience: lease.target?.serviceAudience,
    billingAppId: reservation.billingAppId,
    scopeId: reservation.scopeId,
    identityVersion: lease.policySnapshot?.identityVersion,
    registryVersion: lease.policySnapshot?.registryVersion,
    traceId: reservation._id,
    detail: { amount: reservation.amount, bizId: reservation.bizId, attemptCount },
    createdAt: now,
  }
  await persistImmutableAudit(transaction, audit)
}

async function persistImmutableAudit(transaction, audit) {
  const existing = await readDocument(transaction, COLLECTIONS.audits, audit._id, false)
  if (existing) {
    if (!auditMatches(existing, audit))
      throw new SyntheticBudgetError('audit_event_conflict', 'Synthetic audit event is immutable')
    return
  }
  await setDocument(transaction, COLLECTIONS.audits, audit._id, audit)
}

function auditMatches(existing, expected) {
  return Object.entries(expected).every(([key, value]) => JSON.stringify(existing[key]) === JSON.stringify(value))
}

function requireOutcome(outcome) {
  if (!outcome)
    throw new SyntheticBudgetError('broker_state_unavailable', 'Synthetic reservation transaction returned no result')
  return outcome
}

module.exports = {
  COLLECTIONS,
  SyntheticBudgetError,
  assertInternalReconcileToken,
  createSyntheticBudgetStore,
  reservationDocumentId,
  shanghaiDateKey,
  syntheticAuditDocumentId,
  syntheticCoinTransactionId,
}
