import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

// Match the cloud function's CommonJS loader. Mixing Vite's ESM transform with
// require() would instantiate two policy WeakMaps for the same source file.
const require = createRequire(import.meta.url)
const { assertSandboxUser, createSandboxIapDatabase, parseSandboxUsers, SANDBOX_COLLECTIONS } = require('../../cloudfunctions/wxpay-order/lib/iap-sandbox.js')
const { purchaseAccountToken } = require('../../cloudfunctions/wxpay-order/lib/iap-settlement.js')
const { grantIapTransaction, handleIapRefund } = require('../../cloudfunctions/wxpay-order/lib/iap.js')

const NOW = 1750000000000
function input(kind = 'coin', environment = 'Sandbox', userId = 'alice') {
  return {
    userId,
    environment,
    now: NOW,
    payload: {
      transactionId: '20001',
      originalTransactionId: '20001',
      bundleId: 'fun.yunle.apps',
      productId: kind === 'coin' ? 'fun.yunle.apps.coin_100' : 'fun.yunle.apps.member_month',
      environment,
      appAccountToken: purchaseAccountToken(userId),
      purchaseDate: NOW,
      price: 12000,
      currency: 'CNY',
    },
  }
}

// Both transaction and ordinary accesses fail immediately on a real collection.
function protectProduction(raw, writeFailure = () => false) {
  const accesses = []
  function mapped(target, name, transaction) {
    accesses.push({ name, transaction })
    if (!Object.values(SANDBOX_COLLECTIONS).includes(name))
      throw new Error(`Production collection accessed: ${name}`)
    const collection = target.collection(name)
    if (!transaction)
      return collection
    return {
      doc(id) {
        const ref = collection.doc(id)
        return {
          ...ref,
          async set(data) {
            if (writeFailure(name))
              throw new Error('injected receipt failure')
            return ref.set(data)
          },
        }
      },
    }
  }
  return {
    accesses,
    db: {
      collection: name => mapped(raw, name, false),
      runTransaction: callback => raw.runTransaction(tx => callback({ collection: name => mapped(tx, name, true) })),
    },
  }
}

describe('sandbox ledger capabilities', () => {
  it.each([undefined, '', 'null', '{}', '[]', '["*"]', '["anon"]', '[" alice"]', '["alice","alice"]', '[1]', JSON.stringify(Array.from({ length: 21 }, (_, i) => `uid${i}`))])('fails closed for invalid server allowlist %s', (value) => {
    expect(() => parseSandboxUsers(value)).toThrow('白名单')
  })

  it('maps all five collections in queries and transactions, denying unknown collections and raw access', async () => {
    const raw = makeFakeDb()
    const { db, accesses } = protectProduction(raw)
    const users = ['alice']
    const sandbox = createSandboxIapDatabase(db, users)
    users.push('bob')
    expect(() => assertSandboxUser(sandbox, 'bob')).toThrow('账号')
    for (const name of Object.keys(SANDBOX_COLLECTIONS)) {
      await sandbox.collection(name).doc('outside').set({ value: 1 })
      await sandbox.runTransaction(tx => tx.collection(name).doc('inside').set({ value: 2 }))
    }
    expect(accesses.filter(x => x.transaction)).toHaveLength(5)
    expect(accesses.filter(x => !x.transaction)).toHaveLength(5)
    for (const name of ['test_identities', 'ios_sandbox_orders', '__proto__', 'constructor', 'other']) {
      expect(() => sandbox.collection(name)).toThrow('集合')
      await expect(sandbox.runTransaction(tx => tx.collection(name))).rejects.toThrow('集合')
    }
    expect(Object.keys(sandbox).sort()).toEqual(['collection', 'runTransaction'])
    expect(Object.isFrozen(sandbox)).toBe(true)
    expect(sandbox._store).toBeUndefined()
  })

  it('cannot enable Sandbox on an unscoped database by adding an environment property', async () => {
    const raw = makeFakeDb()
    raw.environment = 'Sandbox'
    vi.spyOn(raw, 'collection')
    await expect(grantIapTransaction(raw, input())).rejects.toMatchObject({ code: 'IAP_ENVIRONMENT_UNSUPPORTED' })
    expect(raw.collection).not.toHaveBeenCalled()
  })

  it.each(['Production', 'Xcode', undefined])('rejects signed environment %s before database access', async (environment) => {
    const { db, accesses } = protectProduction(makeFakeDb())
    const sandbox = createSandboxIapDatabase(db, ['alice'])
    const value = input()
    value.environment = environment
    value.payload.environment = environment
    await expect(grantIapTransaction(sandbox, value)).rejects.toThrow(/环境|Production/)
    await expect(handleIapRefund(sandbox, { payload: value.payload, now: NOW })).rejects.toThrow(/环境|Production/)
    expect(accesses).toHaveLength(0)
  })

  it.each(['coin', 'member'])('isolates same-ID %s purchase, concurrent restore and repeated refund from Production', async (kind) => {
    const raw = makeFakeDb({}, { rejectDocumentIdWrites: true })
    await grantIapTransaction(raw, input(kind, 'Production'))
    const production = structuredClone(raw._store)
    const { db, accesses } = protectProduction(raw)
    const sandbox = createSandboxIapDatabase(db, ['alice'])
    const results = await Promise.all(Array.from({ length: 10 }, () => grantIapTransaction(sandbox, input(kind))))
    expect(results.filter(r => r.granted)).toHaveLength(1)
    expect(results.filter(r => r.alreadyProcessed)).toHaveLength(9)
    expect(raw._store.ios_sandbox_orders).toHaveLength(1)
    expect(raw._store.ios_sandbox_orders[0].meta.environment).toBe('Sandbox')
    if (kind === 'coin') {
      expect(raw._store.ios_sandbox_user_wallet[0].balance).toBe(100)
      expect(raw._store.ios_sandbox_coin_transactions).toHaveLength(1)
    }
    const payload = { ...input(kind).payload, revocationDate: NOW + 1000 }
    await handleIapRefund(sandbox, { payload, now: NOW + 1000 })
    await handleIapRefund(sandbox, { payload, now: NOW + 1000 })
    expect(raw._store.ios_sandbox_orders[0].status).toBe('refunded')
    expect((await grantIapTransaction(sandbox, input(kind))).alreadyProcessed).toBe(true)
    if (kind === 'coin') {
      expect(raw._store.ios_sandbox_user_wallet[0].balance).toBe(0)
      expect(raw._store.ios_sandbox_coin_transactions.filter(t => t.type === 'refund')).toHaveLength(1)
    }
    else {
      expect(raw._store.ios_sandbox_user_memberships[0].expireAt).toBe(NOW + 1000)
      expect(raw._store.ios_sandbox_orders[0].refundEntitlementStatus).toBe('reverted')
    }
    for (const [name, docs] of Object.entries(production))
      expect(raw._store[name]).toEqual(docs)
    expect(accesses.some(x => x.transaction)).toBe(true)
  })

  it.each(['coin', 'member'])('rolls back the entire Sandbox %s grant on receipt failure, then safely retries a lost response', async (kind) => {
    const raw = makeFakeDb()
    let fail = true
    const { db } = protectProduction(raw, name => fail && name === 'ios_sandbox_orders')
    const sandbox = createSandboxIapDatabase(db, ['alice'])
    await expect(grantIapTransaction(sandbox, input(kind))).rejects.toThrow('injected receipt failure')
    expect(Object.values(raw._store).flat()).toHaveLength(0)
    fail = false
    await grantIapTransaction(sandbox, input(kind)) // Simulate losing the successful response.
    expect((await grantIapTransaction(sandbox, input(kind))).alreadyProcessed).toBe(true)
    expect(raw._store.ios_sandbox_orders).toHaveLength(1)
  })

  it('requires an allowlisted caller and a matching signed account token, including refunds', async () => {
    const raw = makeFakeDb()
    const { db, accesses } = protectProduction(raw)
    const sandbox = createSandboxIapDatabase(db, ['alice'])
    await expect(grantIapTransaction(sandbox, input('coin', 'Sandbox', 'bob'))).rejects.toThrow('账号')
    const missing = input()
    delete missing.payload.appAccountToken
    await expect(grantIapTransaction(sandbox, missing)).rejects.toThrow('账号标记')
    expect(accesses).toHaveLength(0)
    await grantIapTransaction(sandbox, input())
    const before = structuredClone(raw._store)
    for (const token of [undefined, purchaseAccountToken('bob')]) {
      await expect(handleIapRefund(sandbox, { payload: { ...input().payload, appAccountToken: token }, now: NOW })).rejects.toThrow('账号标记')
      expect(raw._store).toEqual(before)
    }
    const removed = createSandboxIapDatabase(db, ['bob'])
    await expect(handleIapRefund(removed, { payload: input().payload, now: NOW })).rejects.toThrow('账号')
    expect(raw._store).toEqual(before)
  })

  it('rejects a different account claiming the same transaction even when both are allowlisted', async () => {
    const raw = makeFakeDb()
    const { db } = protectProduction(raw)
    const sandbox = createSandboxIapDatabase(db, ['alice', 'bob'])
    await grantIapTransaction(sandbox, input())
    const before = structuredClone(raw._store)
    await expect(grantIapTransaction(sandbox, input('coin', 'Sandbox', 'bob'))).rejects.toThrow('其他账号')
    expect(raw._store).toEqual(before)
  })

  it('propagates a missing test collection without falling back to Production', async () => {
    const collection = vi.fn(() => {
      throw new Error('collection does not exist')
    })
    const transaction = vi.fn()
    const sandbox = createSandboxIapDatabase({ collection, runTransaction: transaction }, ['alice'])
    await expect(grantIapTransaction(sandbox, input())).rejects.toThrow('collection does not exist')
    expect(collection).toHaveBeenCalledExactlyOnceWith('ios_sandbox_orders')
    expect(transaction).not.toHaveBeenCalled()
  })
})
