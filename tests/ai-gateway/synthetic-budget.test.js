import { describe, expect, it } from 'vitest'

import {
  assertInternalReconcileToken,
  createSyntheticBudgetStore,
  reservationDocumentId,
  syntheticCoinTransactionId,
} from '../../cloudfunctions/ai-gateway/lib/synthetic-budget.js'

const NOW = Date.UTC(2026, 6, 17)

describe('ai-gateway synthetic budget transactions', () => {
  it('requires a dedicated non-empty token for reconciliation', () => {
    const token = 'reconcile-token-with-at-least-32-bytes'
    expect(() => assertInternalReconcileToken(token, token)).not.toThrow()
    expect(() => assertInternalReconcileToken('wrong', token)).toThrow(/鉴权/)
    expect(() => assertInternalReconcileToken('', '')).toThrow(/未配置/)
  })

  it('reserves coin and one model call without persisting model input', async () => {
    const db = new MemoryDb(validDocuments())
    const store = createSyntheticBudgetStore(db)
    const result = await store.reserve(operation())
    const reservation = db.get('test_identity_coin_reservations', result.reservationId)

    expect(result).toMatchObject({ kind: 'reserved' })
    expect(reservation).toMatchObject({
      action: 'wish:audit',
      amount: 1,
      bizId: 'wish:req-01:audit',
      generationStatus: 'reserved',
      status: 'reserved',
    })
    expect(JSON.stringify(reservation)).not.toContain('private wish')
    expect(db.get('test_identity_leases', 'lease_01').usage).toMatchObject({
      coinReserved: 1,
      modelCallsReserved: 1,
    })
  })

  it('deduplicates the same lease and bizId without reserving twice', async () => {
    const db = new MemoryDb(validDocuments())
    const store = createSyntheticBudgetStore(db)

    const first = await store.reserve(operation())
    const replay = await store.reserve(operation())

    expect(replay).toEqual(first)
    expect(db.get('test_identity_leases', 'lease_01').usage.coinReserved).toBe(1)
    expect(db.get('test_identity_leases', 'lease_01').usage.modelCallsReserved).toBe(1)
  })

  it('enforces lease and daily budgets before creating a reservation', async () => {
    const documents = validDocuments()
    documents.test_identity_leases.lease_01.usage.coinSpent = 2
    const db = new MemoryDb(documents)
    const store = createSyntheticBudgetStore(db)

    await expect(store.reserve(operation())).resolves.toEqual({ kind: 'budget_exceeded' })
    expect(db.get('test_identity_coin_reservations', reservationDocumentId('lease_01', 'wish:req-01:audit')))
      .toBeUndefined()
  })

  it('allows only one reserved-to-generating transition', async () => {
    const db = new MemoryDb(validDocuments())
    const store = createSyntheticBudgetStore(db)
    const reserved = await store.reserve(operation())

    await expect(store.start({ ...operation(), reservationId: reserved.reservationId }))
      .resolves
      .toEqual({ kind: 'started' })
    await expect(store.start({ ...operation(), reservationId: reserved.reservationId }))
      .resolves
      .toEqual({ kind: 'in_progress' })
    expect(db.get('test_identity_leases', 'lease_01').usage).toMatchObject({
      modelCallsReserved: 0,
      modelCallsStarted: 1,
    })
  })

  it('releases an unstarted reservation when lease release wins the transaction race', async () => {
    const db = new MemoryDb(validDocuments())
    const store = createSyntheticBudgetStore(db)
    const reserved = await store.reserve(operation())
    db.documents.test_identity_leases.lease_01.status = 'revoking'

    await expect(store.start({ ...operation(), reservationId: reserved.reservationId }))
      .resolves
      .toEqual({ kind: 'lease_inactive' })
    expect(db.get('test_identity_leases', 'lease_01').usage).toMatchObject({
      coinReserved: 0,
      modelCallsReserved: 0,
      modelCallsStarted: 0,
    })
  })

  it('releases coin on model failure but never rolls back the started call count', async () => {
    const db = new MemoryDb(validDocuments())
    const store = createSyntheticBudgetStore(db)
    const reserved = await store.reserve(operation())
    const state = { ...operation(), reservationId: reserved.reservationId }
    await store.start(state)
    await store.failGeneration(state)

    expect(db.get('test_identity_coin_reservations', reserved.reservationId)).toMatchObject({
      generationStatus: 'failed',
      status: 'released',
    })
    expect(db.get('test_identity_leases', 'lease_01').usage).toMatchObject({
      coinReserved: 0,
      modelCallsStarted: 1,
    })
  })

  it('settles a succeeded reservation from reserved coin into spent coin', async () => {
    const db = new MemoryDb(validDocuments())
    const store = createSyntheticBudgetStore(db)
    const reserved = await store.reserve(operation())
    const state = { ...operation(), reservationId: reserved.reservationId }
    await store.start(state)
    await store.succeedGeneration(state)
    await store.settle({ ...state, coinTransactionId: 'tx_01' })

    expect(db.get('test_identity_coin_reservations', reserved.reservationId)).toMatchObject({
      coinTransactionId: 'tx_01',
      generationStatus: 'succeeded',
      status: 'settled',
    })
    expect(db.get('test_identity_leases', 'lease_01').usage).toMatchObject({ coinReserved: 0, coinSpent: 1 })
    expect(db.get('test_identity_usage_daily', 'identity_01:2026-07-17')).toMatchObject({ coinReserved: 0, coinSpent: 1 })
  })

  it('reconciles a committed account transaction into settled budget counters', async () => {
    const db = new MemoryDb(validDocuments())
    const store = createSyntheticBudgetStore(db)
    const reserved = await store.reserve(operation())
    const state = { ...operation(), reservationId: reserved.reservationId }
    await store.start(state)
    await store.succeedGeneration(state)
    await store.markReconcile(state)
    const transactionId = syntheticCoinTransactionId('test_uid_01', 'wish:req-01:audit')
    db.documents.coin_transactions = {
      [transactionId]: {
        _id: transactionId,
        userId: 'test_uid_01',
        appId: 'everything-generator',
        type: 'consume',
        amount: -1,
        refId: 'wish:req-01:audit',
        meta: {
          synthetic: true,
          syntheticLeaseId: 'lease_01',
          syntheticReservationId: reserved.reservationId,
          syntheticScopeId: 'wish',
        },
      },
    }

    await expect(store.reconcile({ now: NOW + 180_000 })).resolves.toMatchObject({ settled: 1 })
    expect(db.get('test_identity_coin_reservations', reserved.reservationId)).toMatchObject({
      status: 'settled',
      coinTransactionId: transactionId,
    })
    expect(db.get('test_identity_leases', 'lease_01').usage).toMatchObject({ coinReserved: 0, coinSpent: 1 })
  })

  it('releases stale reservations that never started without consuming a model call', async () => {
    const db = new MemoryDb(validDocuments())
    const store = createSyntheticBudgetStore(db)
    const reserved = await store.reserve(operation())

    await expect(store.reconcile({ now: NOW + 180_000 })).resolves.toMatchObject({ released: 1 })
    expect(db.get('test_identity_coin_reservations', reserved.reservationId)).toMatchObject({
      generationStatus: 'failed',
      status: 'released',
    })
    expect(db.get('test_identity_leases', 'lease_01').usage).toMatchObject({
      coinReserved: 0,
      modelCallsReserved: 0,
      modelCallsStarted: 0,
    })
  })

  it('releases stale in-flight coin while preserving the started model-call count', async () => {
    const db = new MemoryDb(validDocuments())
    const store = createSyntheticBudgetStore(db)
    const reserved = await store.reserve(operation())
    await store.start({ ...operation(), reservationId: reserved.reservationId })

    await expect(store.reconcile({ now: NOW + 180_000 })).resolves.toMatchObject({ released: 1 })
    expect(db.get('test_identity_coin_reservations', reserved.reservationId)).toMatchObject({
      generationStatus: 'unknown',
      status: 'released',
    })
    expect(db.get('test_identity_leases', 'lease_01').usage).toMatchObject({
      coinReserved: 0,
      modelCallsReserved: 0,
      modelCallsStarted: 1,
    })
  })
})

function operation() {
  return {
    action: 'wish:audit',
    amount: 1,
    billingAppId: 'everything-generator',
    bizId: 'wish:req-01:audit',
    claims: {
      leaseId: 'lease_01',
      identityId: 'identity_01',
      effectiveUid: 'test_uid_01',
      platformAppId: 'app_01',
      serviceAudience: 'ai-gateway',
      billingAppId: 'everything-generator',
      scopeIds: ['wish'],
      allowedActions: ['wish:audit', 'wish:finalize'],
      identityVersion: 7,
      registryVersion: '2026-07-17.1',
    },
    identity: { _id: 'identity_01', uid: 'test_uid_01' },
    now: NOW,
    scopeId: 'wish',
    uid: 'test_uid_01',
  }
}

function validDocuments() {
  const target = {
    platformAppId: 'app_01',
    origin: 'https://dao.yunle.fun',
    serviceAudience: 'ai-gateway',
    billingAppId: 'everything-generator',
    scopeIds: ['wish'],
    allowedActions: ['wish:audit', 'wish:finalize'],
  }
  return {
    test_identities: {
      identity_01: {
        _id: 'identity_01',
        uid: 'test_uid_01',
        synthetic: true,
        status: 'leased',
        activeLeaseId: 'lease_01',
        version: 8,
      },
    },
    test_identity_leases: {
      lease_01: {
        _id: 'lease_01',
        identityId: 'identity_01',
        effectiveUid: 'test_uid_01',
        target,
        status: 'active',
        expiresAt: NOW + 600_000,
        budget: { maxCoin: 2 },
        policySnapshot: {
          identityVersion: 7,
          registryVersion: '2026-07-17.1',
          maxCoinPerLease: 2,
          maxCoinPerDay: 6,
          maxModelCallsPerLease: 2,
          maxModelCallsPerDay: 6,
        },
        usage: { coinReserved: 0, coinSpent: 0, modelCallsReserved: 0, modelCallsStarted: 0 },
      },
    },
    test_identity_usage_daily: {
      'identity_01:2026-07-17': {
        _id: 'identity_01:2026-07-17',
        identityId: 'identity_01',
        dateKey: '2026-07-17',
        timezone: 'Asia/Shanghai',
        coinSpent: 0,
        coinReserved: 0,
        modelCallsReserved: 0,
        modelCallsStarted: 0,
        version: 1,
      },
    },
    test_identity_coin_reservations: {},
  }
}

class MemoryDb {
  constructor(documents) {
    this.documents = structuredClone(documents)
  }

  get(collection, id) {
    const value = this.documents[collection]?.[id]
    return value ? structuredClone(value) : undefined
  }

  collection(name) {
    return this.ref(name)
  }

  ref(name) {
    const query = {
      where: filters => ({
        orderBy: () => ({
          limit: count => ({
            get: async () => ({
              data: Object.values(this.documents[name] || {})
                .filter(value => matches(value, filters))
                .sort((a, b) => a.updatedAt - b.updatedAt)
                .slice(0, count),
            }),
          }),
        }),
      }),
      doc: id => ({
        get: async () => ({ data: this.get(name, id) ? [this.get(name, id)] : [] }),
        set: async (value) => {
          this.documents[name] ||= {}
          this.documents[name][id] = structuredClone(value)
          return { created: 1 }
        },
        update: async (value) => {
          if (!this.documents[name]?.[id])
            return { updated: 0 }
          Object.assign(this.documents[name][id], structuredClone(value))
          return { updated: 1 }
        },
      }),
    }
    return query
  }

  async runTransaction(callback) {
    return callback({ collection: name => this.ref(name) })
  }

  command = {
    lte: value => ({ operator: 'lte', value }),
  }
}

function matches(value, filters) {
  return Object.entries(filters).every(([key, expected]) => {
    if (expected?.operator === 'lte')
      return value[key] <= expected.value
    return value[key] === expected
  })
}
