import Module, { createRequire } from 'node:module'
import { resolve } from 'node:path'
import process from 'node:process'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertGrantablePayload } from '../../cloudfunctions/wxpay-order/lib/appstore.js'
import { purchaseAccountToken } from '../../cloudfunctions/wxpay-order/lib/iap-settlement.js'
import { grantIapTransaction } from '../../cloudfunctions/wxpay-order/lib/iap.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

// Apple cryptographic validation is stubbed here; these tests prove handler
// authorization and ledger routing, not a real Apple Sandbox purchase.
const NOW = 1750000000000
const h = {}
function transaction() {
  return {
    transactionId: '20001',
    originalTransactionId: '20001',
    productId: 'fun.yunle.apps.coin_100',
    bundleId: 'fun.yunle.apps',
    environment: h.environment,
    appAccountToken: purchaseAccountToken('alice'),
    price: 12000,
    currency: 'CNY',
    purchaseDate: NOW,
    ...h.payload,
  }
}
const service = {
  getVerifiedTransaction: vi.fn(async () => ({ payload: transaction(), environment: h.environment })),
  verifyNotification: vi.fn(async () => ({
    notificationType: 'REFUND',
    data: { signedTransactionInfo: 'signed-transaction', environment: h.notificationEnvironment },
  })),
  verifyTransactionInfo: vi.fn(async () => ({ ...transaction(), revocationDate: NOW + 1000 })),
}
const callFunction = vi.fn(async () => ({ result: h.accountAccess }))
function collection(target, name) {
  h.accesses.push(name)
  if (!name.startsWith('ios_sandbox_'))
    throw new Error(`Production collection accessed: ${name}`)
  return target.collection(name)
}
const cloudbase = {
  SYMBOL_CURRENT_ENV: Symbol.for('test-env'),
  init: () => ({
    auth: () => ({ getUserInfo: () => ({ uid: h.uid, isAnonymous: h.isAnonymous }) }),
    callFunction,
    database: () => ({
      collection: name => collection(h.db, name),
      runTransaction: callback => h.db.runTransaction(tx => callback({ collection: name => collection(tx, name) })),
    }),
  }),
}
const event = { httpMethod: 'POST', body: { signedPayload: 'signed-notification' } }

describe('sandbox function entry points', () => {
  let order
  let notify
  beforeAll(() => {
    const original = Module._load
    Module._load = function (request, parent, isMain) {
      if (request === '@cloudbase/node-sdk')
        return cloudbase
      if (request === './lib/appstore' && /\/(?:iap-order|appstore-notify)(?:-sandbox)?\/(?:sandbox|index)\.js$/.test(parent?.filename || '')) {
        return {
          assertGrantablePayload,
          createAppStoreService(config) {
            if (!config.issuerId || !config.keyId || !config.privateKeyPem || !config.bundleId)
              throw new Error('test missing configuration')
            return service
          },
        }
      }
      return original.call(this, request, parent, isMain)
    }
    try {
      const require = createRequire(import.meta.url)
      const entry = name => process.env.IAP_SANDBOX_PACKAGE_ROOT
        ? resolve(process.env.IAP_SANDBOX_PACKAGE_ROOT, `${name}-sandbox/index.js`)
        : require.resolve(`../../cloudfunctions/${name}/sandbox.js`)
      for (const name of ['iap-order', 'appstore-notify'])
        delete require.cache[entry(name)]
      order = require(entry('iap-order')).main
      notify = require(entry('appstore-notify')).main
    }
    finally {
      Module._load = original
    }
  })
  beforeEach(async () => {
    vi.resetAllMocks()
    vi.stubEnv('APPSTORE_ISSUER_ID', 'test-issuer')
    vi.stubEnv('APPSTORE_KEY_ID', 'test-key')
    vi.stubEnv('APPSTORE_PRIVATE_KEY', 'test-private-key')
    vi.stubEnv('APPSTORE_BUNDLE_ID', 'fun.yunle.apps')
    vi.stubEnv('ACCOUNT_API_INTERNAL_TOKEN', 'test-internal-token')
    vi.stubEnv('IAP_SANDBOX_TEST_UIDS', '["alice"]')
    Object.assign(h, { db: makeFakeDb(), uid: 'alice', isAnonymous: false, environment: 'Production', notificationEnvironment: 'Sandbox', payload: {}, accesses: [], accountAccess: { restricted: false, state: 'active' } })
    await grantIapTransaction(h.db, { userId: 'alice', payload: transaction(), environment: 'Production', now: NOW })
    h.production = structuredClone(h.db._store)
    h.environment = 'Sandbox'
  })
  afterEach(() => {
    for (const [name, docs] of Object.entries(h.production))
      expect(h.db._store[name]).toEqual(docs)
    vi.unstubAllEnvs()
  })

  it('verifies, deduplicates restore and refunds only the Sandbox same-ID order', async () => {
    expect(await order({ action: 'verifyPurchase', transactionId: '20001', environment: 'Production', userId: 'bob', collection: 'orders' }))
      .toMatchObject({ granted: true, ledgerEnvironment: 'Sandbox' })
    expect(callFunction).toHaveBeenCalledWith({ name: 'account-api', data: { action: 'getAccountAccessForUser', serviceToken: 'test-internal-token', userId: 'alice' } })
    expect((await order({ action: 'restore', transactionIds: ['20001', '20001'] })).results)
      .toEqual([{ transactionId: '20001', ok: true, granted: false }])
    expect(h.db._store.ios_sandbox_user_wallet[0].balance).toBe(100)
    expect((await notify(event)).statusCode).toBe(200)
    expect((await notify(event)).statusCode).toBe(200)
    expect(h.db._store.ios_sandbox_user_wallet[0].balance).toBe(0)
    expect(h.db._store.ios_sandbox_orders[0].status).toBe('refunded')
    expect(h.accesses.every(name => name.startsWith('ios_sandbox_'))).toBe(true)
  })

  it.each(['', 'anon', 'bob'])('rejects caller %s before account, Apple or database access', async (uid) => {
    h.uid = uid
    await expect(order({ action: 'verifyPurchase', transactionId: '20001', userId: 'alice', testUid: 'alice' })).rejects.toThrow('账号')
    expect(callFunction).not.toHaveBeenCalled()
    expect(service.getVerifiedTransaction).not.toHaveBeenCalled()
    expect(h.accesses).toHaveLength(0)
  })

  it.each(['admin_banned', 'deletion_pending', 'deletion_finalizing', 'unknown'])('preserves active-account restriction %s', async (state) => {
    h.accountAccess = { restricted: true, state }
    await expect(order({ action: 'restore', transactionIds: [] })).rejects.toThrow('账号')
    expect(service.getVerifiedTransaction).not.toHaveBeenCalled()
    expect(h.accesses).toHaveLength(0)
  })

  it.each(['IAP_SANDBOX_TEST_UIDS', 'ACCOUNT_API_INTERNAL_TOKEN', 'APPSTORE_ISSUER_ID', 'APPSTORE_KEY_ID', 'APPSTORE_PRIVATE_KEY', 'APPSTORE_BUNDLE_ID'])('fails closed without %s', async (name) => {
    vi.stubEnv(name, '')
    await expect(order({ action: 'verifyPurchase', transactionId: '20001' })).rejects.toThrow()
    expect(service.getVerifiedTransaction).not.toHaveBeenCalled()
    expect(h.accesses).toHaveLength(0)
  })

  it('rejects a verified Production transaction even when the client claims Sandbox', async () => {
    h.environment = 'Production'
    await expect(order({ action: 'verifyPurchase', transactionId: '20001', environment: 'Sandbox' })).rejects.toMatchObject({ code: 'IAP_ENVIRONMENT_UNSUPPORTED' })
    expect((await order({ action: 'restore', transactionIds: ['20001'] })).results[0].ok).toBe(false)
    expect(h.accesses).toHaveLength(0)
  })

  it.each([
    { transactionId: '20002' },
    { bundleId: 'other.app' },
    { productId: 'unknown' },
    { appAccountToken: undefined },
    { appAccountToken: purchaseAccountToken('bob') },
    { revocationDate: NOW },
  ])('rejects an inconsistent verified payload %j without writing', async (payload) => {
    h.payload = payload
    await expect(order({ action: 'verifyPurchase', transactionId: '20001' })).rejects.toThrow()
    expect(h.accesses).toHaveLength(0)
  })

  it('does not write after Apple verification failure and does not echo its details on restore', async () => {
    service.getVerifiedTransaction.mockRejectedValue(new Error('private diagnostic sentinel'))
    const result = await order({ action: 'restore', transactionIds: ['20001'] })
    expect(result.results[0]).toEqual({ transactionId: '20001', ok: false, error: 'Sandbox 交易校验失败' })
    expect(h.accesses).toHaveLength(0)
  })

  it.each([null, ['invalid'], [20001], Array.from({ length: 11 }).fill('20001')])('rejects malformed restore list %j', async (transactionIds) => {
    await expect(order({ action: 'restore', transactionIds })).rejects.toThrow('列表')
    expect(service.getVerifiedTransaction).not.toHaveBeenCalled()
    expect(h.accesses).toHaveLength(0)
  })

  it('empty restore checks trusted account and config without a purchase or database operation', async () => {
    expect(await order({ action: 'restore', transactionIds: [] })).toEqual({ results: [], ledgerEnvironment: 'Sandbox' })
    expect(callFunction).toHaveBeenCalledOnce()
    expect(service.getVerifiedTransaction).not.toHaveBeenCalled()
    expect(h.accesses).toHaveLength(0)
  })

  it('rejects an anonymous session even when its UID was accidentally allowlisted', async () => {
    h.isAnonymous = true
    await expect(order({ action: 'verifyPurchase', transactionId: '20001' })).rejects.toThrow('账号')
    expect(callFunction).not.toHaveBeenCalled()
    expect(service.getVerifiedTransaction).not.toHaveBeenCalled()
    expect(h.accesses).toHaveLength(0)
  })

  it('rejects unsigned or Production notifications before ledger access', async () => {
    service.verifyNotification.mockRejectedValueOnce(new Error('invalid signature'))
    expect((await notify(event)).statusCode).toBe(401)
    h.notificationEnvironment = 'Production'
    expect((await notify(event)).statusCode).toBe(400)
    expect(service.verifyTransactionInfo).not.toHaveBeenCalled()
    expect(h.accesses).toHaveLength(0)
  })

  it.each([
    { environment: 'Production' },
    { bundleId: 'other.app' },
    { transactionId: '../20001' },
    { revocationDate: 0 },
  ])('rejects invalid signed refund %j', async (payload) => {
    service.verifyTransactionInfo.mockResolvedValue({ ...transaction(), revocationDate: NOW + 1000, ...payload })
    expect((await notify(event)).statusCode).toBe(400)
    expect(h.accesses).toHaveLength(0)
  })

  it('requires current allowlist and signed owner token before refunding an existing test order', async () => {
    await order({ action: 'verifyPurchase', transactionId: '20001' })
    const before = structuredClone(h.db._store)
    vi.stubEnv('IAP_SANDBOX_TEST_UIDS', '["bob"]')
    expect((await notify(event)).statusCode).toBe(500)
    expect(h.db._store).toEqual(before)
    vi.stubEnv('IAP_SANDBOX_TEST_UIDS', '["alice"]')
    h.payload = { appAccountToken: purchaseAccountToken('bob') }
    expect((await notify(event)).statusCode).toBe(500)
    expect(h.db._store).toEqual(before)
  })

  it('retries after a missing test collection without selecting a Production fallback', async () => {
    const original = h.db.collection
    h.db.collection = () => {
      throw new Error('missing collection')
    }
    await expect(order({ action: 'verifyPurchase', transactionId: '20001' })).rejects.toThrow('missing collection')
    h.db.collection = original
    expect((await order({ action: 'verifyPurchase', transactionId: '20001' })).granted).toBe(true)
    expect(h.accesses.every(name => name.startsWith('ios_sandbox_'))).toBe(true)
  })

  it('retries a refund interrupted after marking the test order, without double clawback', async () => {
    await order({ action: 'verifyPurchase', transactionId: '20001' })
    const original = h.db.runTransaction
    h.db.runTransaction = async () => {
      throw new Error('injected database outage')
    }
    expect((await notify(event)).statusCode).toBe(500)
    expect(h.db._store.ios_sandbox_orders[0].status).toBe('refunded')
    expect(h.db._store.ios_sandbox_user_wallet[0].balance).toBe(100)
    h.db.runTransaction = original
    expect((await notify(event)).statusCode).toBe(200)
    expect((await notify(event)).statusCode).toBe(200)
    expect(h.db._store.ios_sandbox_user_wallet[0].balance).toBe(0)
    expect(h.db._store.ios_sandbox_coin_transactions.filter(t => t.type === 'refund')).toHaveLength(1)
  })
})
