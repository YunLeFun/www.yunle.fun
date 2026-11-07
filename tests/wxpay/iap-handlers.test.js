import Module, { createRequire } from 'node:module'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertGrantablePayload } from '../../cloudfunctions/wxpay-order/lib/appstore.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

// Exercise the deployed entry points with an in-memory database and a service
// returning already-verified payloads. This does not test real Apple signatures.
const h = { db: null, environment: 'Production', notificationEnvironment: 'Production' }
function transaction() {
  return {
    transactionId: '20001',
    originalTransactionId: '20001',
    productId: 'fun.yunle.apps.coin_100',
    bundleId: 'fun.yunle.apps',
    environment: h.environment,
    price: 12000,
    currency: 'CNY',
  }
}
const service = {
  getVerifiedTransaction: vi.fn(async () => ({ payload: transaction(), environment: h.environment })),
  verifyNotification: vi.fn(async () => ({
    notificationType: 'REFUND',
    data: { signedTransactionInfo: 'verified-transaction', environment: h.notificationEnvironment },
  })),
  verifyTransactionInfo: vi.fn(async () => ({ ...transaction(), revocationDate: 1750000001000 })),
}
const dbProxy = new Proxy({}, {
  get(_target, property) {
    const value = h.db[property]
    return typeof value === 'function' ? value.bind(h.db) : value
  },
})
const cloudbaseStub = {
  SYMBOL_CURRENT_ENV: Symbol.for('test-env'),
  init: () => ({
    auth: () => ({ getUserInfo: () => ({ uid: 'alice', isAnonymous: h.isAnonymous }) }),
    callFunction: async () => ({ result: { restricted: false, state: 'active' } }),
    database: () => dbProxy,
  }),
}
const event = { httpMethod: 'POST', body: { signedPayload: 'verified-notification' } }

describe('iAP entry point environment isolation', () => {
  let order
  let notify

  beforeAll(() => {
    const originalLoad = Module._load
    Module._load = function (request, parent, isMain) {
      if (request === '@cloudbase/node-sdk')
        return cloudbaseStub
      if (request === './lib/appstore' && /\/cloudfunctions\/(?:iap-order|appstore-notify)\/index\.js$/.test(parent?.filename || ''))
        return { assertGrantablePayload, createAppStoreService: () => service }
      return originalLoad.call(this, request, parent, isMain)
    }
    try {
      const require = createRequire(import.meta.url)
      for (const name of ['iap-order', 'appstore-notify']) {
        const path = require.resolve(`../../cloudfunctions/${name}/index.js`)
        delete require.cache[path]
      }
      order = require('../../cloudfunctions/iap-order/index.js').main
      notify = require('../../cloudfunctions/appstore-notify/index.js').main
    }
    finally {
      Module._load = originalLoad
    }
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('APPSTORE_ISSUER_ID', 'test-issuer')
    vi.stubEnv('APPSTORE_KEY_ID', 'test-key')
    vi.stubEnv('APPSTORE_PRIVATE_KEY', 'test-private-key')
    vi.stubEnv('APPSTORE_BUNDLE_ID', 'fun.yunle.apps')
    vi.stubEnv('ACCOUNT_API_INTERNAL_TOKEN', 'test-internal-token')
    h.db = makeFakeDb({ test_identities: [] })
    h.environment = 'Production'
    h.isAnonymous = false
    h.notificationEnvironment = 'Production'
  })
  afterEach(() => vi.unstubAllEnvs())

  it('rejects an authenticated anonymous session before capability or purchase handling', async () => {
    h.isAnonymous = true
    const before = structuredClone(h.db._store)
    for (const action of ['getCapabilities', 'verifyPurchase'])
      await expect(order({ action, transactionId: '20001' })).rejects.toThrow('请先登录')
    expect(service.getVerifiedTransaction).not.toHaveBeenCalled()
    expect(h.db._store).toEqual(before)
  })

  it('returns Cook capabilities after account checks without requesting an Apple transaction', async () => {
    vi.stubEnv('APPSTORE_BUNDLE_ID', 'fun.yunle.cook')
    const result = await order({ action: 'getCapabilities', userId: 'bob', environment: 'Sandbox' })
    expect(result).toMatchObject({ application: 'cook', bundleId: 'fun.yunle.cook', ledgerEnvironment: 'Production' })
    expect(result.products).toHaveLength(2)
    expect(result.products.every(product => product.kind === 'nonRenewing')).toBe(true)
    expect(service.getVerifiedTransaction).not.toHaveBeenCalled()
    h.db._store.test_identities = [{ _id: 'fixed-test', uid: 'alice', synthetic: true }]
    await expect(order({ action: 'getCapabilities' })).rejects.toThrow('测试账号')
  })

  it('rejects verifyPurchase Sandbox even when the client claims Production', async () => {
    h.environment = 'Sandbox'
    const before = structuredClone(h.db._store)
    await expect(order({ action: 'verifyPurchase', transactionId: '20001', environment: 'Production' }))
      .rejects
      .toMatchObject({ code: 'IAP_ENVIRONMENT_UNSUPPORTED' })
    expect(h.db._store).toEqual(before)
  })

  it('reports Sandbox restore as unsuccessful and leaves all entitlements unchanged', async () => {
    h.environment = 'Sandbox'
    const before = structuredClone(h.db._store)
    const result = await order({ action: 'restore', transactionIds: ['20001'] })
    expect(result.results).toEqual([{ transactionId: '20001', ok: false, error: expect.stringContaining('Sandbox') }])
    expect(h.db._store).toEqual(before)
  })

  it('retains the synthetic-account prohibition before requesting Apple verification', async () => {
    h.db._store.test_identities = [{ _id: 'fixed-test', uid: 'alice', synthetic: true }]
    await expect(order({ action: 'verifyPurchase', transactionId: '20001' })).rejects.toThrow('测试账号')
    expect(service.getVerifiedTransaction).not.toHaveBeenCalled()
  })

  it('preserves Production verification, restore deduplication and refund', async () => {
    expect((await order({ action: 'verifyPurchase', transactionId: '20001' })).granted).toBe(true)
    expect((await order({ action: 'restore', transactionIds: ['20001'] })).results)
      .toEqual([{ transactionId: '20001', ok: true, granted: false }])
    expect(h.db._store.user_wallet[0].balance).toBe(100)
    expect((await notify(event)).statusCode).toBe(200)
    expect(h.db._store.user_wallet[0].balance).toBe(0)
    expect(h.db._store.orders[0].status).toBe('refunded')
  })

  it('acknowledges a verified Sandbox refund without touching the same-ID Production order', async () => {
    await order({ action: 'verifyPurchase', transactionId: '20001' })
    const before = structuredClone(h.db._store)
    h.environment = h.notificationEnvironment = 'Sandbox'
    const result = await notify(event)
    expect(result.statusCode).toBe(200)
    expect(JSON.parse(result.body)).toEqual({ ok: true, ignored: 'sandbox-entitlements-disabled' })
    expect(service.verifyTransactionInfo).toHaveBeenCalledWith('verified-transaction', 'Sandbox')
    expect(h.db._store).toEqual(before)
  })

  it('rejects disagreement between signed notification and transaction environments', async () => {
    h.environment = 'Sandbox'
    const before = structuredClone(h.db._store)
    expect((await notify(event)).statusCode).toBe(500)
    expect(h.db._store).toEqual(before)
  })

  it('does not default a missing notification environment to Production', async () => {
    h.notificationEnvironment = undefined
    expect((await notify(event)).statusCode).toBe(500)
    expect(service.verifyTransactionInfo).not.toHaveBeenCalled()
  })
})
