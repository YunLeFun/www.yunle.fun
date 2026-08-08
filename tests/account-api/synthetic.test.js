import process from 'node:process'
import { beforeEach, describe, expect, it } from 'vitest'

import { handleAdminAdjustCoin, handleDeductCoinForUser } from '../../cloudfunctions/account-api/internal.js'
import { COIN_TX_COLLECTION, WALLET_COLLECTION } from '../../cloudfunctions/account-api/lib/wallet.js'
import {
  assertSyntheticSessionAction,
  classifyAccountIdentity,
  handlePrepareSyntheticBaseline,
  handleSyntheticDeductCoinForUser,
  syntheticReservationId,
} from '../../cloudfunctions/account-api/synthetic.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = Date.UTC(2026, 6, 17)
const TOKEN = 'ai-gateway-account-token'.padEnd(32, 'x')
const CLEANUP_TOKEN = 'cleanup-token'.padEnd(32, 'x')

beforeEach(() => {
  process.env.YUNLEFUN_TEST_ACCOUNT_ENVIRONMENT = 'test'
})

describe('account-api synthetic wallet settlement', () => {
  it('revalidates reservation, lease, identity, and wallet in one transaction', async () => {
    const db = syntheticDb()
    const result = await handleSyntheticDeductCoinForUser(db, event(), { expectedToken: TOKEN, now: NOW })

    expect(result).toMatchObject({ balance: 1, deduped: false, transactionId: expect.any(String) })
    expect(db._store[WALLET_COLLECTION][0]).toMatchObject({ balance: 1, version: 2 })
    expect(db._store[COIN_TX_COLLECTION][0]).toMatchObject({
      userId: 'test_uid_01',
      appId: 'everything-generator',
      amount: -1,
      refId: 'wish:req-01:audit',
      meta: {
        kind: 'aiChat',
        synthetic: true,
        syntheticLeaseId: 'lease_01',
        syntheticReservationId: syntheticReservationId('lease_01', 'wish:req-01:audit'),
        syntheticScopeId: 'wish',
      },
    })
    expect(db._store.test_identity_coin_reservations[0]).toMatchObject({
      billingStatus: 'charged',
      coinTransactionId: result.transactionId,
    })
  })

  it('is idempotent for the same reservation and never deducts twice', async () => {
    const db = syntheticDb()
    const first = await handleSyntheticDeductCoinForUser(db, event(), { expectedToken: TOKEN, now: NOW })
    const replay = await handleSyntheticDeductCoinForUser(db, event(), { expectedToken: TOKEN, now: NOW + 1 })

    expect(replay).toEqual({ ...first, deduped: true })
    expect(db._store[WALLET_COLLECTION][0].balance).toBe(1)
    expect(db._store[COIN_TX_COLLECTION]).toHaveLength(1)
  })

  it('retries a transient CloudBase transaction conflict without changing the idempotency key', async () => {
    const db = syntheticDb()
    const runTransaction = db.runTransaction.bind(db)
    let attempts = 0
    db.runTransaction = async (callback) => {
      attempts += 1
      if (attempts === 1) {
        const error = new Error('[ResourceUnavailable.TransactionBusy] Transaction is busy')
        error.code = 'ResourceUnavailable.TransactionBusy'
        throw error
      }
      return await runTransaction(callback)
    }
    const delays = []

    const result = await handleSyntheticDeductCoinForUser(db, event(), {
      expectedToken: TOKEN,
      now: NOW,
      sleep: async delay => delays.push(delay),
    })

    expect(result).toMatchObject({ balance: 1, deduped: false, transactionId: expect.any(String) })
    expect(attempts).toBe(2)
    expect(delays).toEqual([60])
    expect(db._store[WALLET_COLLECTION][0].balance).toBe(1)
    expect(db._store[COIN_TX_COLLECTION]).toHaveLength(1)
  })

  it('keeps account settlement idempotent after the budget reservation is settled', async () => {
    const db = syntheticDb()
    const first = await handleSyntheticDeductCoinForUser(db, event(), { expectedToken: TOKEN, now: NOW })
    Object.assign(db._store.test_identity_coin_reservations[0], {
      status: 'settled',
      settledAt: NOW + 1,
    })

    await expect(handleSyntheticDeductCoinForUser(db, event(), {
      expectedToken: TOKEN,
      now: NOW + 2,
    })).resolves.toEqual({ ...first, deduped: true })
    expect(db._store[WALLET_COLLECTION][0].balance).toBe(1)
    expect(db._store[COIN_TX_COLLECTION]).toHaveLength(1)
  })

  it.each([
    ['wrong service token', event({ serviceToken: 'wrong' }), {}],
    ['released lease', event(), { lease: { status: 'revoking' } }],
    ['identity pointer changed', event(), { identity: { activeLeaseId: 'lease_other' } }],
    ['generation not succeeded', event(), { reservation: { generationStatus: 'generating' } }],
    ['scope mismatch', event({ syntheticScopeId: 'other' }), {}],
  ])('rejects %s before wallet mutation', async (_label, input, patches) => {
    const db = syntheticDb(patches)
    await expect(handleSyntheticDeductCoinForUser(db, input, { expectedToken: TOKEN, now: NOW })).rejects.toThrow()
    expect(db._store[WALLET_COLLECTION][0].balance).toBe(2)
    expect(db._store[COIN_TX_COLLECTION] ?? []).toHaveLength(0)
  })

  it('ignores caller metadata and always writes server-owned synthetic markers', async () => {
    const db = syntheticDb()
    await handleSyntheticDeductCoinForUser(db, event({ meta: { synthetic: false, injected: true } }), {
      expectedToken: TOKEN,
      now: NOW,
    })
    expect(db._store[COIN_TX_COLLECTION][0].meta).not.toHaveProperty('injected')
    expect(db._store[COIN_TX_COLLECTION][0].meta.synthetic).toBe(true)
  })
})

describe('account-api synthetic mutation guard', () => {
  it('initializes a disabled managed identity wallet to its protected baseline idempotently', async () => {
    const db = syntheticDb({
      identity: {
        source: 'managed',
        status: 'disabled',
        activeLeaseId: undefined,
      },
      wallet: null,
    })
    const input = {
      serviceToken: CLEANUP_TOKEN,
      identityId: 'identity_01',
      userId: 'test_uid_01',
      identityVersion: 8,
    }

    const first = await handlePrepareSyntheticBaseline(db, input, {
      expectedToken: CLEANUP_TOKEN,
      now: NOW,
    })
    const replay = await handlePrepareSyntheticBaseline(db, input, {
      expectedToken: CLEANUP_TOKEN,
      now: NOW + 1,
    })

    expect(first).toEqual({ balance: 2, deduped: false, transactionId: expect.any(String) })
    expect(replay).toEqual({ ...first, deduped: true })
    expect(db._store[WALLET_COLLECTION]).toHaveLength(1)
    expect(db._store[WALLET_COLLECTION][0]).toMatchObject({ userId: 'test_uid_01', balance: 2, version: 1 })
    expect(db._store[COIN_TX_COLLECTION]).toHaveLength(1)
    expect(db._store[COIN_TX_COLLECTION][0]).toMatchObject({
      userId: 'test_uid_01',
      amount: 2,
      balanceAfter: 2,
      refId: 'synthetic-baseline:identity_01:v8',
      meta: {
        synthetic: true,
        syntheticBaseline: true,
        syntheticIdentityId: 'identity_01',
        syntheticIdentityVersion: 8,
      },
    })
  })

  it('creates a durable wallet for a zero-coin baseline', async () => {
    const db = syntheticDb({
      identity: {
        source: 'managed',
        status: 'disabled',
        activeLeaseId: undefined,
        baseline: { coin: 0, enabled: true },
      },
      wallet: null,
    })
    const input = {
      serviceToken: CLEANUP_TOKEN,
      identityId: 'identity_01',
      userId: 'test_uid_01',
      identityVersion: 8,
    }

    const first = await handlePrepareSyntheticBaseline(db, input, {
      expectedToken: CLEANUP_TOKEN,
      now: NOW,
    })
    const replay = await handlePrepareSyntheticBaseline(db, input, {
      expectedToken: CLEANUP_TOKEN,
      now: NOW + 1,
    })

    expect(first).toEqual({ balance: 0, deduped: false })
    expect(replay).toEqual({ balance: 0, deduped: true })
    expect(db._store[WALLET_COLLECTION]).toHaveLength(1)
    expect(db._store[WALLET_COLLECTION][0]).toMatchObject({
      userId: 'test_uid_01',
      balance: 0,
      version: 1,
    })
    expect(db._store[COIN_TX_COLLECTION] ?? []).toHaveLength(0)
  })

  it('reduces an existing disabled wallet to the exact protected baseline', async () => {
    const db = syntheticDb({
      identity: {
        source: 'managed',
        status: 'disabled',
        activeLeaseId: undefined,
      },
      wallet: { balance: 5 },
    })

    await expect(handlePrepareSyntheticBaseline(db, {
      serviceToken: CLEANUP_TOKEN,
      identityId: 'identity_01',
      userId: 'test_uid_01',
      identityVersion: 8,
    }, {
      expectedToken: CLEANUP_TOKEN,
      now: NOW,
    })).resolves.toMatchObject({ balance: 2, deduped: false })
    expect(db._store[COIN_TX_COLLECTION][0]).toMatchObject({ amount: -3, balanceAfter: 2 })
  })

  it('fails closed when a replayed baseline receipt no longer matches the wallet', async () => {
    const db = syntheticDb({
      identity: { source: 'managed', status: 'disabled', activeLeaseId: undefined },
      wallet: null,
    })
    const input = {
      serviceToken: CLEANUP_TOKEN,
      identityId: 'identity_01',
      userId: 'test_uid_01',
      identityVersion: 8,
    }
    await handlePrepareSyntheticBaseline(db, input, {
      expectedToken: CLEANUP_TOKEN,
      now: NOW,
    })
    db._store[WALLET_COLLECTION][0].balance = 1

    await expect(handlePrepareSyntheticBaseline(db, input, {
      expectedToken: CLEANUP_TOKEN,
      now: NOW + 1,
    })).rejects.toThrow(/冲突|基线/)
  })

  it('rejects weak baseline service tokens before wallet mutation', async () => {
    const db = syntheticDb({
      identity: { source: 'managed', status: 'disabled', activeLeaseId: undefined },
    })
    await expect(handlePrepareSyntheticBaseline(db, {
      serviceToken: 'short',
      identityId: 'identity_01',
      userId: 'test_uid_01',
      identityVersion: 8,
    }, {
      expectedToken: 'short',
      now: NOW,
    })).rejects.toMatchObject({ code: 'synthetic_baseline_not_configured', httpStatus: 503 })
    expect(db._store[WALLET_COLLECTION][0].balance).toBe(2)
  })

  it('rejects a corrupted baseline transaction receipt on replay', async () => {
    const db = syntheticDb({
      identity: { source: 'managed', status: 'disabled', activeLeaseId: undefined },
      wallet: null,
    })
    const input = {
      serviceToken: CLEANUP_TOKEN,
      identityId: 'identity_01',
      userId: 'test_uid_01',
      identityVersion: 8,
    }
    await handlePrepareSyntheticBaseline(db, input, { expectedToken: CLEANUP_TOKEN, now: NOW })
    Object.assign(db._store[COIN_TX_COLLECTION][0], { amount: 0, type: 'consume' })

    await expect(handlePrepareSyntheticBaseline(db, input, {
      expectedToken: CLEANUP_TOKEN,
      now: NOW + 1,
    })).rejects.toMatchObject({ code: 'synthetic_baseline_conflict' })
  })

  it.each([
    ['wrong token', { serviceToken: 'wrong' }, {}],
    ['wrong version', { identityVersion: 7 }, {}],
    ['active identity', {}, { identity: { status: 'leased', activeLeaseId: 'lease_01' } }],
    ['orphaned active lease expiry', {}, { identity: { activeLeaseId: undefined, activeLeaseExpiresAt: 0 } }],
    ['baseline above safety cap', {}, { identity: { baseline: { coin: 21, enabled: true } } }],
    ['legacy identity', {}, { identity: { source: 'legacy', status: 'quarantined', activeLeaseId: undefined } }],
  ])('rejects synthetic baseline preparation for %s', async (_label, eventPatch, dbPatch) => {
    const db = syntheticDb({
      identity: {
        source: 'managed',
        status: 'disabled',
        activeLeaseId: undefined,
        ...dbPatch.identity,
      },
    })
    await expect(handlePrepareSyntheticBaseline(db, {
      serviceToken: CLEANUP_TOKEN,
      identityId: 'identity_01',
      userId: 'test_uid_01',
      identityVersion: 8,
      ...eventPatch,
    }, {
      expectedToken: CLEANUP_TOKEN,
      now: NOW,
    })).rejects.toThrow()
    expect(db._store[WALLET_COLLECTION][0].balance).toBe(2)
    expect(db._store[COIN_TX_COLLECTION] ?? []).toHaveLength(0)
  })

  it('allows only getAccount and listTransactions for a logged-in synthetic identity', () => {
    expect(() => assertSyntheticSessionAction('getAccount')).not.toThrow()
    expect(() => assertSyntheticSessionAction('listTransactions')).not.toThrow()
    expect(() => assertSyntheticSessionAction('signIn')).toThrow(/测试身份/)
    expect(() => assertSyntheticSessionAction('deductCoin')).toThrow(/测试身份/)
    expect(() => assertSyntheticSessionAction('requestAccountDeletion')).toThrow(/测试身份/)
  })

  it('allows the explicit fixed-account test surface while keeping unrelated mutations blocked', () => {
    const identity = {
      _id: 'fixed-1',
      synthetic: true,
      accountKind: 'fixed',
      environment: 'test',
      status: 'ready',
    }
    expect(() => assertSyntheticSessionAction('deductCoin', identity)).not.toThrow()
    expect(() => assertSyntheticSessionAction('listOrders', identity)).not.toThrow()
    expect(() => assertSyntheticSessionAction('signIn', identity)).toThrow(/测试身份/)
  })

  it('fails closed when classification is unavailable', async () => {
    const db = {
      collection: () => ({
        where: () => ({
          limit: () => ({
            get: async () => {
              throw new Error('down')
            },
          }),
        }),
      }),
    }
    await expect(classifyAccountIdentity(db, 'user_01')).rejects.toMatchObject({
      code: 'synthetic_classification_unavailable',
      httpStatus: 503,
    })
  })

  it('rejects the legacy internal deduct path for a synthetic uid', async () => {
    const db = syntheticDb()
    await expect(handleDeductCoinForUser(db, {
      serviceToken: 'legacy-token',
      userId: 'test_uid_01',
      appId: 'everything-generator',
      amount: 1,
      bizId: 'wish:req-01:audit',
    }, { expectedToken: 'legacy-token', now: NOW })).rejects.toMatchObject({ code: 'synthetic_action_forbidden' })
    expect(db._store[WALLET_COLLECTION][0].balance).toBe(2)
  })

  it('allows only the broker cleanup token and stable reset key to restore a synthetic baseline', async () => {
    const db = syntheticDb({
      identity: { status: 'cleaning' },
      lease: { status: 'cleaning' },
      wallet: { balance: 1 },
    })
    const reset = {
      serviceToken: CLEANUP_TOKEN,
      userId: 'test_uid_01',
      appId: 'admin-test-broker',
      amount: 1,
      refId: 'synthetic-reset:lease_01:wallet',
      reason: 'synthetic test identity baseline restore',
      operator: 'cleanup-sweeper',
      syntheticLeaseId: 'lease_01',
    }

    await expect(handleAdminAdjustCoin(db, reset, {
      expectedToken: 'legacy-token',
      expectedCleanupToken: CLEANUP_TOKEN,
      now: NOW,
    })).resolves.toMatchObject({ balance: 2 })
    expect(db._store[COIN_TX_COLLECTION][0].meta).toMatchObject({
      syntheticReset: true,
      syntheticLeaseId: 'lease_01',
    })

    const wrongDb = syntheticDb({ identity: { status: 'cleaning' }, lease: { status: 'cleaning' } })
    await expect(handleAdminAdjustCoin(wrongDb, { ...reset, serviceToken: 'legacy-token' }, {
      expectedToken: 'legacy-token',
      expectedCleanupToken: CLEANUP_TOKEN,
      now: NOW,
    })).rejects.toThrow(/鉴权失败/)
  })

  it('rejects a cleanup adjustment that is not the exact wallet baseline delta', async () => {
    const db = syntheticDb({
      identity: { status: 'cleaning' },
      lease: { status: 'cleaning' },
      wallet: { balance: 1 },
    })
    const reset = {
      serviceToken: CLEANUP_TOKEN,
      userId: 'test_uid_01',
      appId: 'admin-test-broker',
      amount: 2,
      refId: 'synthetic-reset:lease_01:wallet',
      reason: 'synthetic test identity baseline restore',
      operator: 'cleanup-sweeper',
      syntheticLeaseId: 'lease_01',
    }

    await expect(handleAdminAdjustCoin(db, reset, {
      expectedToken: 'legacy-token',
      expectedCleanupToken: CLEANUP_TOKEN,
      now: NOW,
    })).rejects.toMatchObject({ code: 'synthetic_reset_invalid' })
    expect(db._store[WALLET_COLLECTION][0].balance).toBe(1)
  })

  it('never treats an empty unconfigured token class as authenticated', async () => {
    const synthetic = syntheticDb({ identity: { status: 'cleaning' }, lease: { status: 'cleaning' } })
    await expect(handleAdminAdjustCoin(synthetic, {
      serviceToken: '',
      userId: 'test_uid_01',
      appId: 'admin-test-broker',
      amount: 1,
      refId: 'synthetic-reset:lease_01:wallet',
      reason: 'synthetic test identity baseline restore',
      operator: 'cleanup-sweeper',
      syntheticLeaseId: 'lease_01',
    }, {
      expectedToken: 'legacy-token',
      expectedCleanupToken: '',
      now: NOW,
    })).rejects.toThrow(/鉴权失败/)

    const regular = makeFakeDb({
      test_identities: [],
      [WALLET_COLLECTION]: [{ _id: 'wallet_regular', userId: 'regular_uid', balance: 1, version: 1 }],
    })
    await expect(handleAdminAdjustCoin(regular, {
      serviceToken: '',
      userId: 'regular_uid',
      appId: 'admin',
      amount: 1,
      refId: 'admin:regular-adjust',
      reason: 'manual adjustment',
      operator: 'owner',
    }, {
      expectedToken: '',
      expectedCleanupToken: CLEANUP_TOKEN,
      now: NOW,
    })).rejects.toThrow(/鉴权失败/)
    expect(regular._store[WALLET_COLLECTION][0].balance).toBe(1)
  })
})

function event(patch = {}) {
  return {
    serviceToken: TOKEN,
    userId: 'test_uid_01',
    appId: 'everything-generator',
    amount: 1,
    bizId: 'wish:req-01:audit',
    reservationId: syntheticReservationId('lease_01', 'wish:req-01:audit'),
    syntheticLeaseId: 'lease_01',
    syntheticScopeId: 'wish',
    ...patch,
  }
}

function syntheticDb(patches = {}) {
  const reservationId = syntheticReservationId('lease_01', 'wish:req-01:audit')
  const identity = {
    _id: 'identity_01',
    uid: 'test_uid_01',
    synthetic: true,
    status: 'leased',
    activeLeaseId: 'lease_01',
    version: 8,
    baseline: { coin: 2, enabled: true },
    ...patches.identity,
  }
  const lease = {
    _id: 'lease_01',
    identityId: 'identity_01',
    effectiveUid: 'test_uid_01',
    status: 'active',
    expiresAt: NOW + 600_000,
    target: {
      serviceAudience: 'ai-gateway',
      billingAppId: 'everything-generator',
      scopeIds: ['wish'],
      allowedActions: ['wish:audit', 'wish:finalize'],
    },
    policySnapshot: { identityVersion: 7 },
    ...patches.lease,
  }
  const reservation = {
    _id: reservationId,
    identityId: 'identity_01',
    leaseId: 'lease_01',
    effectiveUid: 'test_uid_01',
    billingAppId: 'everything-generator',
    scopeId: 'wish',
    action: 'wish:audit',
    bizId: 'wish:req-01:audit',
    amount: 1,
    generationStatus: 'succeeded',
    status: 'reserved',
    ...patches.reservation,
  }
  const wallet = patches.wallet === null
    ? []
    : [{
        _id: 'wallet_01',
        userId: 'test_uid_01',
        balance: 2,
        version: 1,
        ...patches.wallet,
      }]
  return makeFakeDb({
    test_identities: [identity],
    test_identity_leases: [lease],
    test_identity_coin_reservations: [reservation],
    [WALLET_COLLECTION]: wallet,
  })
}
