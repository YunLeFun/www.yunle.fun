import process from 'node:process'
import { beforeEach, describe, expect, it } from 'vitest'

import { handleAdminAdjustCoin, handleDeductCoinForUser } from '../../cloudfunctions/account-api/internal.js'
import { COIN_TX_COLLECTION, WALLET_COLLECTION } from '../../cloudfunctions/account-api/lib/wallet.js'
import {
  assertSyntheticSessionAction,
  classifyAccountIdentity,
  handlePrepareSyntheticBaseline,
} from '../../cloudfunctions/account-api/synthetic.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = Date.UTC(2026, 6, 17)
const CLEANUP_TOKEN = 'cleanup-token'.padEnd(32, 'x')

beforeEach(() => {
  process.env.YUNLEFUN_TEST_ACCOUNT_ENVIRONMENT = 'test'
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

  it('allows only account ledger reads for a logged-in synthetic identity', () => {
    expect(() => assertSyntheticSessionAction('getAccount')).not.toThrow()
    expect(() => assertSyntheticSessionAction('getMyAiPointAccount')).not.toThrow()
    expect(() => assertSyntheticSessionAction('listMyAiPointTransactions')).not.toThrow()
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

function syntheticDb(patches = {}) {
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
      serviceAudience: 'ai-runtime',
      billingAppId: 'everything-generator',
      scopeIds: ['wish'],
      allowedActions: ['wish:audit', 'wish:finalize'],
    },
    policySnapshot: { identityVersion: 7 },
    ...patches.lease,
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
    [WALLET_COLLECTION]: wallet,
  })
}
