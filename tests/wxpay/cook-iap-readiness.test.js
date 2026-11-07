import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const require = createRequire(import.meta.url)
const { getIapCapabilities, reconcileIapTransaction } = require('../../cloudfunctions/wxpay-order/lib/iap-client.js')
const { createSandboxIapDatabase } = require('../../cloudfunctions/wxpay-order/lib/iap-sandbox.js')
const { purchaseAccountToken } = require('../../cloudfunctions/wxpay-order/lib/iap-settlement.js')

const now = Date.parse('2026-11-06T00:00:00Z')
function purchase(environment = 'Production') {
  return { userId: 'alice', transactionId: '70101', bundleId: 'fun.yunle.cook', environment, now, payload: { transactionId: '70101', originalTransactionId: '70101', bundleId: 'fun.yunle.cook', productId: 'fun.yunle.cook.member_month', type: 'Non-Renewing Subscription', environment, purchaseDate: now, appAccountToken: purchaseAccountToken('alice') } }
}

describe('cook client readiness and verified revocations', () => {
  it('advertises only implemented products, with explicit application and ledger markers', () => {
    for (const lane of ['Production', 'Sandbox']) {
      expect(getIapCapabilities('fun.yunle.cook', lane)).toEqual({
        application: 'cook',
        bundleId: 'fun.yunle.cook',
        ledgerEnvironment: lane,
        products: [{ id: 'fun.yunle.cook.member_month', kind: 'nonRenewing' }, { id: 'fun.yunle.cook.member_year', kind: 'nonRenewing' }],
      })
    }
    expect(() => getIapCapabilities('fun.yunle.cook', 'Xcode')).toThrow('环境')
    expect(() => getIapCapabilities('__proto__', 'Production')).toThrow('未登记')
  })

  it.each(['Production', 'Sandbox'])('confirms duplicate settlement and conservative refunds on the %s ledger', async (environment) => {
    const raw = makeFakeDb()
    const db = environment === 'Sandbox' ? createSandboxIapDatabase(raw, ['alice']) : raw
    const input = purchase(environment)
    const first = await reconcileIapTransaction(db, input)
    expect(first).toMatchObject({ granted: true, application: 'cook', bundleId: input.bundleId, ledgerEnvironment: environment, outTradeNo: 'iap_70101' })
    const orders = raw._store[environment === 'Sandbox' ? 'ios_sandbox_orders' : 'orders']
    const members = raw._store[environment === 'Sandbox' ? 'ios_sandbox_user_memberships' : 'user_memberships']
    const expiry = members[0].expireAt
    expect(await reconcileIapTransaction(db, input)).toMatchObject({ alreadyProcessed: true })
    expect(members[0].expireAt).toBe(expiry)
    members[0].lastOrderId = 'later-web-order'
    input.payload.revocationDate = now + 1
    expect(await reconcileIapTransaction(db, input)).toMatchObject({ revoked: true, granted: false })
    expect(orders[0].refundEntitlementStatus).toBe('manual_review_required')
    expect(members[0].expireAt).toBe(expiry)
    expect(await reconcileIapTransaction(db, input)).toMatchObject({ revoked: true })
    expect(orders).toHaveLength(1)
    if (environment === 'Sandbox') {
      expect(raw._store.orders).toBeUndefined()
      expect(raw._store.user_memberships).toBeUndefined()
    }
  })

  it('rolls back the latest Apple grant and acknowledges replay without extending it', async () => {
    const db = makeFakeDb()
    const input = purchase()
    await reconcileIapTransaction(db, input)
    input.payload.revocationDate = now + 1
    expect(await reconcileIapTransaction(db, input)).toMatchObject({ revoked: true })
    const after = structuredClone(db._store)
    expect(await reconcileIapTransaction(db, input)).toMatchObject({ revoked: true })
    expect(db._store).toEqual(after)
    expect(db._store.orders[0].refundEntitlementStatus).toBe('reverted')
  })

  it.each(['id', 'bundle', 'environment', 'owner', 'missing-owner', 'renewal'])('rejects %s disagreement before any ledger write', async (kind) => {
    const db = makeFakeDb()
    const input = purchase()
    if (kind === 'id')
      input.payload.transactionId = '70102'
    if (kind === 'bundle')
      input.payload.bundleId = 'fun.yunle.apps'
    if (kind === 'environment')
      input.payload.environment = 'Sandbox'
    if (kind === 'owner')
      input.payload.appAccountToken = purchaseAccountToken('bob')
    if (kind === 'missing-owner')
      delete input.payload.appAccountToken
    if (kind === 'renewal')
      input.payload.type = 'Auto-Renewable Subscription'
    const before = structuredClone(db._store)
    await expect(reconcileIapTransaction(db, input)).rejects.toThrow()
    expect(db._store).toEqual(before)
  })

  it('keeps an unrecorded revocation pending and rejects another owner of a recorded refund', async () => {
    const db = makeFakeDb()
    const input = purchase()
    input.payload.revocationDate = now + 1
    await expect(reconcileIapTransaction(db, input)).rejects.toThrow('原订单')
    delete input.payload.revocationDate
    await reconcileIapTransaction(db, input)
    const before = structuredClone(db._store)
    input.userId = 'bob'
    input.payload.appAccountToken = purchaseAccountToken('bob')
    input.payload.revocationDate = now + 1
    await expect(reconcileIapTransaction(db, input)).rejects.toThrow('原订单')
    expect(db._store).toEqual(before)
  })
})
