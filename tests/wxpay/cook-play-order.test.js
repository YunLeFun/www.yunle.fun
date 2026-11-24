import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import { createPublisher } from '../../cloudfunctions/cook-play-order/publisher.js'
import { createGooglePushAuthenticator, createPlayPushRouter } from '../../cloudfunctions/cook-play-order/push.js'
import { createPlayRouter, createSandboxLedger, SANDBOX_COLLECTIONS } from '../../cloudfunctions/cook-play-order/routing.js'
import { createPlayOrderService } from '../../cloudfunctions/cook-play-order/settlement.js'
import { revokeGooglePlayOrder, settleGooglePlayOrder } from '../../cloudfunctions/wxpay-order/lib/iap-settlement.js'
import { membershipAccessExpiry } from '../../cloudfunctions/wxpay-order/lib/membership-access.js'
import { grantOrderEntitlement, readMembership } from '../../cloudfunctions/wxpay-order/lib/orders.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = Date.parse('2026-11-21T00:00:00+08:00')
const TOKEN = 'receipt-token-from-play-0312'
const MONTH = 'cook_member_month'
const KEY = 'test-fixture-account-marker-key-value'

function fixture({ environment = 'Production', db = makeFakeDb() } = {}) {
  const play = { getPurchase: vi.fn(), consume: vi.fn().mockResolvedValue(undefined) }
  const membershipLedger = environment === 'Sandbox' ? createSandboxLedger(db) : db
  const service = createPlayOrderService({
    db: membershipLedger,
    play,
    key: KEY,
    ledgerEnvironment: environment,
    clock: () => NOW,
    readMembership,
    membershipAccessExpiry,
    revokeGooglePlayOrder,
    settleGooglePlayOrder,
  })
  const purchase = {
    ...(environment === 'Sandbox' ? { testPurchaseContext: { fopType: 'TEST' } } : {}),
    obfuscatedExternalAccountId: service.capabilities('alice').accountMarker,
    orderId: 'GPA.1234-1234-1234-12345',
    purchaseCompletionTime: new Date(NOW).toISOString(),
    purchaseStateContext: { purchaseState: 'PURCHASED' },
    productLineItem: [{
      productId: MONTH,
      productOfferDetails: {
        purchaseOptionId: 'buy',
        quantity: 1,
        refundableQuantity: 1,
        consumptionState: 'CONSUMPTION_STATE_YET_TO_BE_CONSUMED',
      },
    }],
  }
  play.getPurchase.mockImplementation(async () => structuredClone(purchase))
  return { db, play, purchase, service }
}

describe('cook Google Play non-renewing membership', () => {
  it('extends existing Web expiry, commits before consuming, and is idempotent on replay', async () => {
    const db = makeFakeDb({
      user_memberships: [{ _id: 'alice', expireAt: Date.parse('2026-12-31T00:00:00+08:00'), lastOrderId: 'web-order' }],
    })
    const { play, purchase, service } = fixture({ db })
    play.consume.mockImplementation(async () => {
      expect(db._store.orders[0].grantedAt).toBe(NOW)
      expect(db._store.user_memberships[0].lastOrderId).toBe(db._store.orders[0].outTradeNo)
      purchase.productLineItem[0].productOfferDetails.consumptionState = 'CONSUMPTION_STATE_CONSUMED'
    })
    const result = await service.verifyPurchase('alice', TOKEN)
    expect(result).toMatchObject({
      application: 'cook',
      packageName: 'fun.yunle.cook',
      ledgerEnvironment: 'Production',
      productId: MONTH,
      status: 'confirmed',
    })
    expect(result.purchaseReference).toMatch(/^[0-9a-f]{64}$/)
    await expect(service.verifyPurchase('alice', TOKEN)).resolves.toEqual(result)
    expect(db._store.orders).toHaveLength(1)
    expect(play.consume).toHaveBeenCalledExactlyOnceWith(MONTH, TOKEN)
    expect(db._store.user_memberships[0].expireAt).toBe(Date.parse('2027-01-31T00:00:00+08:00'))
    expect(JSON.stringify(db._store)).not.toContain(TOKEN)
  })

  it('records the grant once when the provider consume has to be retried', async () => {
    const { db, play, service } = fixture()
    play.consume.mockRejectedValueOnce(new Error('provider busy'))
    await expect(service.verifyPurchase('alice', TOKEN)).resolves.toMatchObject({ status: 'committed' })
    const original = { ...db._store.user_memberships[0] }
    await expect(service.verifyPurchase('alice', TOKEN)).resolves.toMatchObject({ status: 'confirmed' })
    expect(play.consume).toHaveBeenCalledTimes(2)
    expect(db._store.orders).toHaveLength(1)
    expect(db._store.user_memberships[0]).toEqual(original)
  })

  it('handles a provider consume response lost after Google recorded it', async () => {
    const { db, play, purchase, service } = fixture()
    play.consume.mockImplementation(async () => {
      purchase.productLineItem[0].productOfferDetails.consumptionState = 'CONSUMPTION_STATE_CONSUMED'
      throw new Error('socket closed')
    })
    await expect(service.verifyPurchase('alice', TOKEN)).resolves.toMatchObject({ status: 'confirmed' })
    expect(db._store.orders).toHaveLength(1)
  })

  it('accepts concurrent submissions for the same annual pass without extending expiry twice', async () => {
    const { db, play, purchase, service } = fixture()
    const line = purchase.productLineItem[0]
    line.productId = 'cook_member_year'
    play.consume.mockImplementation(async () => {
      if (line.productOfferDetails.consumptionState === 'CONSUMPTION_STATE_CONSUMED')
        throw new Error('already consumed')
      line.productOfferDetails.consumptionState = 'CONSUMPTION_STATE_CONSUMED'
    })
    const results = await Promise.all([service.verifyPurchase('alice', TOKEN), service.verifyPurchase('alice', TOKEN)])
    expect(results.map(result => result.status)).toEqual(['confirmed', 'confirmed'])
    expect(db._store.orders).toHaveLength(1)
    expect(db._store.user_memberships[0].expireAt).toBe(Date.parse('2027-11-21T00:00:00+08:00'))
  })

  it('never consumes or retains a membership if the order write rolls back', async () => {
    const { db, play, service } = fixture()
    const transaction = db.runTransaction
    db.runTransaction = callback => transaction(tx => callback({
      collection(name) {
        if (name !== 'orders')
          return tx.collection(name)
        return { doc: id => ({ ...tx.collection(name).doc(id), set: async () => ({ code: 'DB_WRITE_FAILED' }) }) }
      },
    }))
    await expect(service.verifyPurchase('alice', TOKEN)).rejects.toThrow()
    expect(db._store.orders ?? []).toHaveLength(0)
    expect(db._store.user_memberships ?? []).toHaveLength(0)
    expect(play.consume).not.toHaveBeenCalled()
  })

  it.each([
    ['wrong owner', (purchase) => { purchase.obfuscatedExternalAccountId = 'other' }, 'purchase_account_mismatch'],
    ['wrong product', (purchase) => { purchase.productLineItem[0].productId = 'wallet-coins' }, 'unsupported_purchase'],
    ['non-string product', (purchase) => { purchase.productLineItem[0].productId = [MONTH] }, 'unsupported_purchase'],
    ['multiple units', (purchase) => { purchase.productLineItem[0].productOfferDetails.quantity = 2 }, 'unsupported_purchase'],
    ['zero refundable quantity', (purchase) => { purchase.productLineItem[0].productOfferDetails.refundableQuantity = 0 }, 'purchase_unavailable'],
    ['test order against production', (purchase) => { purchase.testPurchaseContext = { fopType: 'TEST' } }, 'purchase_environment_mismatch'],
  ])('rejects %s ahead of grant and consume', async (_name, mutate, code) => {
    const { db, play, purchase, service } = fixture()
    mutate(purchase)
    await expect(service.verifyPurchase('alice', TOKEN)).rejects.toMatchObject({ code })
    expect(db._store).toEqual({})
    expect(play.consume).not.toHaveBeenCalled()
  })

  it('rejects an already consumed receipt without this server’s existing grant', async () => {
    const { db, play, purchase, service } = fixture()
    purchase.productLineItem[0].productOfferDetails.consumptionState = 'CONSUMPTION_STATE_CONSUMED'
    await expect(service.verifyPurchase('alice', TOKEN)).rejects.toThrow('没有已发放的会员凭据')
    expect(db._store.orders ?? []).toHaveLength(0)
    expect(db._store.user_memberships ?? []).toHaveLength(0)
    expect(play.consume).not.toHaveBeenCalled()
  })

  it.each([['PENDING', 'pending'], ['CANCELLED', 'cancelled']])('reports %s without touching the ledger', async (state, status) => {
    const { db, play, purchase, service } = fixture()
    purchase.purchaseStateContext.purchaseState = state
    await expect(service.verifyPurchase('alice', TOKEN)).resolves.toMatchObject({ status })
    expect(db._store).toEqual({})
    expect(play.consume).not.toHaveBeenCalled()
  })

  it('writes test purchases only to the Play-specific test collections', async () => {
    const { db, play, purchase, service } = fixture({ environment: 'Sandbox' })
    await service.preparePurchase('alice', MONTH)
    await expect(service.verifyPurchase('alice', TOKEN)).resolves.toMatchObject({ ledgerEnvironment: 'Sandbox' })
    const result = await service.entitlement('alice')
    expect(result.membership).toMatchObject({ isActive: true })
    expect(Object.keys(db._store).sort()).toEqual(Object.entries(SANDBOX_COLLECTIONS)
      .filter(([name]) => name !== 'play_subscription_progress').map(([, name]) => name).sort())
    delete purchase.testPurchaseContext
    await expect(service.verifyPurchase('alice', TOKEN)).rejects.toMatchObject({ code: 'purchase_environment_mismatch' })
    expect(play.consume).toHaveBeenCalledTimes(1)
  })

  it('refuses the Google channel in the generic Web grant path', async () => {
    const db = makeFakeDb()
    await expect(grantOrderEntitlement(db, { order: { payType: 'google_play' }, now: NOW }))
      .rejects
      .toThrow('Google Play')
    expect(db._store).toEqual({})
  })
})

describe('play delivery after the app has closed', () => {
  it('records only the authenticated owner before opening checkout and handles a delayed payment once', async () => {
    const { db, play, purchase, service } = fixture()
    const checkAccount = vi.fn()
    const router = createPlayRouter({
      getCaller: () => ({ uid: 'alice' }),
      checkAccount,
      getService: () => service,
      enabled: () => true,
    })
    const notice = { kind: 'purchased', token: TOKEN, productId: MONTH }
    await expect(service.processNotification(notice, checkAccount)).resolves.toBe('unregistered_owner')
    expect(db._store.orders).toBeUndefined()
    const prepared = await router({ action: 'preparePurchase', productId: MONTH, uid: 'bob' })
    expect(prepared.accountMarker).toBe(service.capabilities('alice').accountMarker)
    await router({ action: 'preparePurchase', productId: MONTH })
    expect(db._store.play_purchase_owners).toHaveLength(1)
    expect(db._store.play_purchase_owners[0].userId).toBe('alice')
    expect(db._store.orders).toBeUndefined()
    purchase.purchaseStateContext.purchaseState = 'PENDING'
    await expect(service.processNotification(notice, checkAccount)).resolves.toBe('retry')
    expect(play.consume).not.toHaveBeenCalled()
    purchase.purchaseStateContext.purchaseState = 'PURCHASED'
    play.consume.mockImplementation(async () => {
      purchase.productLineItem[0].productOfferDetails.consumptionState = 'CONSUMPTION_STATE_CONSUMED'
    })
    await expect(service.processNotification(notice, checkAccount)).resolves.toBe('confirmed')
    await expect(service.processNotification(notice, checkAccount)).resolves.toBe('confirmed')
    expect(db._store.orders).toHaveLength(1)
    expect(db._store.orders[0].userId).toBe('alice')
    expect(play.consume).toHaveBeenCalledExactlyOnceWith(MONTH, TOKEN)
    expect(checkAccount.mock.calls.every(([uid]) => uid === 'alice')).toBe(true)
  })

  it('keeps a blocked account out of settlement and never consumes its receipt', async () => {
    const { db, play, service } = fixture()
    await service.preparePurchase('alice', MONTH)
    await expect(service.processNotification({ kind: 'purchased', token: TOKEN, productId: MONTH }, async () => {
      throw new Error('account restricted')
    })).rejects.toThrow('account restricted')
    expect(db._store.orders).toBeUndefined()
    expect(play.consume).not.toHaveBeenCalled()
  })

  it('honors the matching ledger only when the same topic sends a test purchase', async () => {
    const db = makeFakeDb()
    const production = fixture({ db })
    const sandbox = fixture({ db, environment: 'Sandbox' })
    await sandbox.service.preparePurchase('alice', MONTH)
    production.play.getPurchase.mockImplementation(() => sandbox.play.getPurchase(TOKEN))
    const notice = { kind: 'purchased', token: TOKEN, productId: MONTH }
    const check = vi.fn()
    await expect(production.service.processNotification(notice, check)).resolves.toBe('other_ledger')
    await expect(sandbox.service.processNotification(notice, check)).resolves.toBe('confirmed')
    expect(db._store.orders).toBeUndefined()
    expect(db._store.user_memberships).toBeUndefined()
    expect(db._store[SANDBOX_COLLECTIONS.orders]).toHaveLength(1)
    expect(check).toHaveBeenCalledExactlyOnceWith('alice')
  })

  it('cancels an unpaid order without a grant', async () => {
    const { db, play, purchase, service } = fixture()
    purchase.purchaseStateContext.purchaseState = 'CANCELLED'
    delete purchase.orderId
    await expect(service.processNotification({ kind: 'cancelled', token: TOKEN, productId: MONTH }, vi.fn()))
      .resolves
      .toBe('cancelled')
    expect(db._store.orders).toBeUndefined()
    expect(play.consume).not.toHaveBeenCalled()
  })
})

describe('play refunds', () => {
  const checkAccount = vi.fn()
  const fullRefund = { kind: 'voided', token: TOKEN, orderId: 'GPA.1234-1234-1234-12345' }
  const oldExpiry = Date.parse('2026-12-31T00:00:00+08:00')

  it('reverts the matching last grant and restores the earlier Web period even if Google no longer serves the receipt', async () => {
    const db = makeFakeDb({
      user_memberships: [{ _id: 'alice', expireAt: oldExpiry, lastOrderId: 'web-order', level: 'basic' }],
    })
    const { play, service } = fixture({ db })
    await service.verifyPurchase('alice', TOKEN)
    play.getPurchase.mockRejectedValue(new Error('no longer served'))
    await expect(service.processNotification(fullRefund, checkAccount)).resolves.toBe('reverted')
    await expect(service.processNotification(fullRefund, checkAccount)).resolves.toBe('reverted')
    expect(db._store.user_memberships[0]).toMatchObject({ expireAt: oldExpiry, lastOrderId: 'web-order', level: 'basic' })
    expect(db._store.orders[0]).toMatchObject({ status: 'refunded', refundEntitlementStatus: 'reverted' })
    expect(play.getPurchase).toHaveBeenCalledTimes(1)
  })

  it('keeps later purchases and records a manual review instead of overwriting newer expiry', async () => {
    const { db, service } = fixture()
    await service.verifyPurchase('alice', TOKEN)
    const later = { expireAt: Date.parse('2028-01-01T00:00:00+08:00'), lastOrderId: 'later-web-order' }
    await db.collection('user_memberships').doc('alice').update(later)
    await expect(service.processNotification(fullRefund, checkAccount)).resolves.toBe('manual_review_required')
    expect(db._store.user_memberships[0]).toMatchObject(later)
    expect(db._store.orders[0]).toMatchObject({ status: 'refunded', refundEntitlementStatus: 'manual_review_required' })
  })

  it('rejects a conflicting order number without changing time or consuming again', async () => {
    const { db, play, service } = fixture()
    await service.verifyPurchase('alice', TOKEN)
    const before = structuredClone(db._store)
    await expect(service.processNotification({ ...fullRefund, orderId: 'GPA.4321-1234-1234-54321' }, checkAccount))
      .rejects
      .toThrow()
    expect(db._store).toEqual(before)
    expect(play.consume).toHaveBeenCalledTimes(1)
  })

  it('prevents a stale verification from granting an order voided before settlement', async () => {
    const { db, play, service } = fixture()
    await expect(service.processNotification(fullRefund, checkAccount)).resolves.toBe('voided')
    await expect(service.verifyPurchase('alice', TOKEN)).resolves.toMatchObject({ status: 'cancelled' })
    expect(db._store.play_purchase_states[0].status).toBe('voided')
    expect(db._store.orders ?? []).toHaveLength(0)
    expect(db._store.user_memberships ?? []).toHaveLength(0)
    expect(play.consume).not.toHaveBeenCalled()
  })

  it('leaves no granted duration when app verification races a full-refund push', async () => {
    const { db, service } = fixture()
    await Promise.all([
      service.verifyPurchase('alice', TOKEN),
      service.processNotification(fullRefund, checkAccount),
    ])
    expect(db._store.play_purchase_states[0].status).toBe('voided')
    expect((await service.entitlement('alice')).membership.isActive).toBe(false)
    expect((db._store.orders ?? []).every(order => order.status === 'refunded')).toBe(true)
  })

  it('leaves both the order and entitlement intact when the refund transaction rolls back', async () => {
    const { db, service } = fixture()
    await service.verifyPurchase('alice', TOKEN)
    const before = structuredClone(db._store)
    const transaction = db.runTransaction
    db.runTransaction = callback => transaction(tx => callback({
      collection(name) {
        if (name !== 'orders')
          return tx.collection(name)
        return { doc: id => ({ ...tx.collection(name).doc(id), set: async () => ({ code: 'DB_WRITE_FAILED' }) }) }
      },
    }))
    await expect(service.processNotification(fullRefund, checkAccount)).rejects.toThrow()
    expect(db._store).toEqual(before)
    db.runTransaction = transaction
    await expect(service.processNotification(fullRefund, checkAccount)).resolves.toBe('reverted')
  })
})

describe('authenticated Google Play push', () => {
  const subscription = 'projects/test-fixture/subscriptions/cook-production'
  const audience = 'https://callback.example.invalid/cook-play'
  const serviceAccount = 'play-notify@example.invalid'
  const headers = { authorization: 'Bearer fixture.claims.signature' }

  function sample(data, envelopeSubscription = subscription) {
    return {
      httpMethod: 'POST',
      headers,
      body: JSON.stringify({
        subscription: envelopeSubscription,
        message: { messageId: 'fixture-id', data: Buffer.from(JSON.stringify(data)).toString('base64') },
      }),
    }
  }

  it('checks the signed identity, audience and exact subscription before accepting lifecycle changes', async () => {
    const verifyIdToken = vi.fn().mockResolvedValue({ getPayload: () => ({ email: serviceAccount, email_verified: true }) })
    const authenticate = createGooglePushAuthenticator({ audience, serviceAccount, verifyIdToken })
    const processNotification = vi.fn().mockResolvedValue('confirmed')
    const checkAccount = vi.fn()
    const route = createPlayPushRouter({
      subscription,
      authenticate,
      enabled: () => true,
      getService: () => ({ processNotification }),
      checkAccount,
    })
    const data = {
      packageName: 'fun.yunle.cook',
      oneTimeProductNotification: { notificationType: 1, purchaseToken: TOKEN, sku: MONTH },
    }
    await expect(route({ ...sample(data), httpMethod: 'GET' })).resolves.toMatchObject({ statusCode: 405 })
    await expect(route({ ...sample(data), headers: {} })).resolves.toMatchObject({ statusCode: 401 })
    verifyIdToken.mockResolvedValueOnce({ getPayload: () => ({ email: 'other@example.invalid', email_verified: true }) })
    await expect(route(sample(data))).resolves.toMatchObject({ statusCode: 401 })
    verifyIdToken.mockResolvedValueOnce({ getPayload: () => ({ email: serviceAccount, email_verified: false }) })
    await expect(route(sample(data))).resolves.toMatchObject({ statusCode: 401 })
    await expect(route(sample(data, 'projects/other/subscriptions/other'))).resolves.toMatchObject({ statusCode: 400 })
    await expect(route(sample({ ...data, packageName: 'fun.other.app' }))).resolves.toMatchObject({ statusCode: 204 })
    expect(processNotification).not.toHaveBeenCalled()
    const event = sample(data)
    await expect(route({ ...event, body: Buffer.from(event.body).toString('base64'), isBase64Encoded: true }))
      .resolves
      .toMatchObject({ statusCode: 204 })
    expect(verifyIdToken).toHaveBeenLastCalledWith({ idToken: 'fixture.claims.signature', audience })
    expect(processNotification).toHaveBeenCalledExactlyOnceWith({ kind: 'purchased', productId: MONTH, token: TOKEN }, checkAccount)
  })

  it('requests redelivery when acknowledgement is pending and accepts only full one-time refunds', async () => {
    const processNotification = vi.fn().mockResolvedValue('committed')
    const route = createPlayPushRouter({
      subscription,
      authenticate: async () => true,
      enabled: () => true,
      getService: () => ({ processNotification }),
      checkAccount: vi.fn(),
    })
    const details = { productType: 2, refundType: 1, orderId: 'GPA.1234-1234-1234-12345', purchaseToken: TOKEN }
    const event = details => sample({ packageName: 'fun.yunle.cook', voidedPurchaseNotification: details })
    await expect(route(event({ ...details, refundType: 2 }))).resolves.toMatchObject({ statusCode: 204 })
    expect(processNotification).not.toHaveBeenCalled()
    await expect(route(event(details))).resolves.toMatchObject({ statusCode: 503 })
    expect(processNotification).toHaveBeenCalledTimes(1)
    expect(processNotification.mock.calls[0][0]).toEqual({ kind: 'voided', orderId: details.orderId, token: TOKEN })
  })
})

describe('google Play function contracts', () => {
  it('uses trusted identity and hides unexpected provider error details', async () => {
    const { service, play } = fixture()
    let identity
    const checkAccount = vi.fn()
    const onFailure = vi.fn()
    const router = createPlayRouter({
      getCaller: () => identity,
      checkAccount,
      getService: () => service,
      enabled: () => true,
      onFailure,
    })
    await expect(router({ action: 'getCapabilities', uid: 'alice' })).resolves.toEqual({ code: 'login_required' })
    expect(checkAccount).not.toHaveBeenCalled()
    identity = { uid: 'bob' }
    await expect(router({ action: 'getCapabilities', uid: 'alice', ledgerEnvironment: 'Sandbox' })).resolves.toEqual(service.capabilities('bob'))
    expect(checkAccount).toHaveBeenCalledWith('bob')
    play.getPurchase.mockRejectedValueOnce(new Error(`Provider exception with ${TOKEN}`))
    await expect(router({ action: 'verifyPurchase', purchaseToken: TOKEN })).resolves.toEqual({ code: 'play_unavailable' })
    expect(onFailure).toHaveBeenCalledExactlyOnceWith('play_unavailable')
  })

  it('uses the fixed package, encodes provider token path segments and refuses redirects', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response('{"kind":"test"}'))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const api = createPublisher({ accessToken: async () => 'provider-access-token', fetch: request })
    const token = 'reserve+/receipt#value'
    await expect(api.getPurchase(token)).resolves.toEqual({ kind: 'test' })
    await api.consume(MONTH, token)
    const root = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/fun.yunle.cook/purchases'
    expect(request.mock.calls[0][0]).toBe(`${root}/productsv2/tokens/${encodeURIComponent(token)}`)
    expect(request.mock.calls[1][0]).toBe(`${root}/products/${MONTH}/tokens/${encodeURIComponent(token)}:consume`)
    expect(request.mock.calls.map(([, opts]) => [opts.method, opts.redirect])).toEqual([['GET', 'error'], ['POST', 'error']])
  })
})
