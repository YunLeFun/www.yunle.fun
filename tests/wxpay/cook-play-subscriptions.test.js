import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import { createPublisher } from '../../cloudfunctions/cook-play-order/publisher.js'
import { purchaseReference } from '../../cloudfunctions/cook-play-order/purchase-proof.js'
import { createPlayPushRouter } from '../../cloudfunctions/cook-play-order/push.js'
import { createPlayRouter, createSandboxLedger } from '../../cloudfunctions/cook-play-order/routing.js'
import { createPlayOrderService } from '../../cloudfunctions/cook-play-order/settlement.js'
import { createRefreshHandler, PLAY_SUBSCRIPTIONS, TRIGGER_NAME } from '../../cloudfunctions/cook-play-order/subscription-refresh.js'
import { SUBSCRIPTION_PRODUCT } from '../../cloudfunctions/cook-play-order/subscriptions.js'
import { googlePlayOrderKey, revokeGooglePlayOrder, settleGooglePlayOrder } from '../../cloudfunctions/wxpay-order/lib/iap-settlement.js'
import { membershipAccessExpiry } from '../../cloudfunctions/wxpay-order/lib/membership-access.js'
import { grantOrderEntitlement, readMembership } from '../../cloudfunctions/wxpay-order/lib/orders.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = Date.parse('2027-01-21T00:00:00+08:00')
const FIRST = 'GPA.4682-1024-2915-43115'
const TOKEN = 'fixture-play-subscription-token-117'
const REPLACEMENT = 'fixture-play-subscription-change-118'
const SECOND = 'GPA.7462-1024-2915-53142'
const ACKNOWLEDGED = 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED'
const SUBSCRIPTION = 'projects/fixture/subscriptions/cook-play'

function paidOrder(orderId, date, token = TOKEN, basePlanId = 'monthly') {
  const eventTime = new Date(date).toISOString()
  return {
    orderId,
    purchaseToken: token,
    state: 'PROCESSED',
    total: { currencyCode: 'CNY', units: '12' },
    orderHistory: { processedEvent: { eventTime } },
    lineItems: [{
      productId: SUBSCRIPTION_PRODUCT,
      subscriptionDetails: {
        basePlanId,
        offerPhaseDetails: { baseDetails: {} },
        servicePeriodStartTime: eventTime,
        servicePeriodEndTime: new Date(date + 28 * 86_400_000).toISOString(),
      },
    }],
  }
}

function fixture({ environment = 'Production', enabled = true, db = makeFakeDb() } = {}) {
  let currentTime = NOW
  const orders = new Map([[FIRST, paidOrder(FIRST, NOW)]])
  const snapshot = {
    kind: 'androidpublisher#subscriptionPurchaseV2',
    ...(environment === 'Sandbox' ? { testPurchase: {} } : {}),
    subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
    acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING',
    lineItems: [{
      productId: SUBSCRIPTION_PRODUCT,
      latestSuccessfulOrderId: FIRST,
      expiryTime: '2027-02-21T00:00:00+08:00',
      offerDetails: { basePlanId: 'monthly' },
      autoRenewingPlan: { autoRenewEnabled: true },
    }],
  }
  const play = {
    getSubscription: vi.fn(async () => structuredClone(snapshot)),
    getOrders: vi.fn(async ids => ids.map(id => structuredClone(orders.get(id))).reverse()),
    acknowledgeSubscription: vi.fn(async () => { snapshot.acknowledgementState = ACKNOWLEDGED }),
    consume: vi.fn(),
  }
  const service = createPlayOrderService({
    db: environment === 'Sandbox' ? createSandboxLedger(db) : db,
    play,
    key: 'separate-fixture-subscription-key-2027',
    ledgerEnvironment: environment,
    clock: () => currentTime,
    readMembership,
    membershipAccessExpiry,
    googlePlayOrderKey,
    revokeGooglePlayOrder,
    settleGooglePlayOrder,
    subscriptionsEnabled: enabled,
  })
  snapshot.externalAccountIdentifiers = { obfuscatedExternalAccountId: service.capabilities('alice').accountMarker }
  function advanceTo(timestamp) {
    currentTime = timestamp
  }
  return { db, orders, snapshot, play, service, advanceTo }
}

function push(service, checkAccount = vi.fn()) {
  const handle = createPlayPushRouter({
    subscription: SUBSCRIPTION,
    authenticate: async () => true,
    enabled: () => true,
    getService: () => service,
    checkAccount,
  })
  return data => handle({
    httpMethod: 'POST',
    body: JSON.stringify({
      subscription: SUBSCRIPTION,
      message: { data: Buffer.from(JSON.stringify({ packageName: 'fun.yunle.cook', ...data })).toString('base64') },
    }),
  })
}

function replacementSnapshot(original, orderId, target = 'yearly') {
  const replacement = structuredClone(original)
  replacement.linkedPurchaseToken = TOKEN
  replacement.acknowledgementState = 'ACKNOWLEDGEMENT_STATE_PENDING'
  const item = replacement.lineItems[0]
  item.itemReplacement = {
    productId: SUBSCRIPTION_PRODUCT,
    basePlanId: item.offerDetails.basePlanId,
    replacementMode: 'WITHOUT_PRORATION',
  }
  item.offerDetails.basePlanId = target
  if (orderId)
    item.latestSuccessfulOrderId = orderId
  else
    delete item.latestSuccessfulOrderId
  return replacement
}

function mockReplacement(play, original, replacement) {
  play.getSubscription.mockImplementation(async token => structuredClone(token === TOKEN ? original : replacement))
  play.acknowledgeSubscription.mockImplementation(async (id, token) => {
    expect(id).toBe(SUBSCRIPTION_PRODUCT)
    const snapshot = token === TOKEN ? original : replacement
    snapshot.acknowledgementState = ACKNOWLEDGED
  })
}

describe('google Play Cook subscriptions', () => {
  it('checks account, acknowledged status, and a different base plan before authorizing a replacement', async () => {
    const { service, play, snapshot } = fixture()
    const change = (owner, plan) => service.preparePurchase(owner, SUBSCRIPTION_PRODUCT, plan, TOKEN)
    await expect(change('alice', 'yearly')).rejects.toMatchObject({ code: 'subscription_change_unavailable' })
    expect(play.acknowledgeSubscription).not.toHaveBeenCalled()
    await service.verifySubscription('alice', TOKEN)
    await expect(change('bob', 'yearly')).rejects.toMatchObject({ code: 'purchase_account_mismatch' })
    await expect(change('alice', 'monthly')).rejects.toMatchObject({ code: 'subscription_change_unavailable' })
    await expect(change('alice', 'yearly')).resolves.toMatchObject({ basePlanId: 'yearly', replacementMode: 'WITHOUT_PRORATION' })
    snapshot.subscriptionState = 'SUBSCRIPTION_STATE_ON_HOLD'
    await expect(change('alice', 'yearly')).rejects.toMatchObject({ code: 'subscription_change_unavailable' })
  })

  it('moves the paid period and the scheduled lookup to the yearly token before charging the next cycle', async () => {
    const { db, orders, play, service, snapshot, advanceTo } = fixture()
    await service.preparePurchase('alice', SUBSCRIPTION_PRODUCT, 'monthly')
    await service.verifySubscription('alice', TOKEN)
    const oldExpiry = db._store.user_memberships[0].expireAt
    const change = replacementSnapshot(snapshot, SECOND)
    mockReplacement(play, snapshot, change)
    orders.set(SECOND, { ...paidOrder(SECOND, NOW, REPLACEMENT, 'yearly'), total: { currencyCode: 'CNY' } })
    const notify = push(service)
    await expect(notify({ subscriptionNotification: { notificationType: 4, purchaseToken: REPLACEMENT } }))
      .resolves
      .toMatchObject({ statusCode: 204 })
    expect(play.acknowledgeSubscription).toHaveBeenLastCalledWith(SUBSCRIPTION_PRODUCT, REPLACEMENT)
    expect(db._store.orders.map(order => order.transactionId)).toEqual([FIRST])
    const previous = purchaseReference(TOKEN)
    const current = purchaseReference(REPLACEMENT)
    expect(db._store.user_memberships[0]).toMatchObject({
      expireAt: oldExpiry,
      playSubscriptionAccess: [{ purchaseReference: current, paidPurchaseReference: previous, orderId: FIRST, expiresAt: oldExpiry }],
    })
    expect(db._store[PLAY_SUBSCRIPTIONS].find(row => row.purchaseReference === previous))
      .toMatchObject({ replacementReference: current })
    expect(db._store[PLAY_SUBSCRIPTIONS].find(row => row.purchaseReference === previous)).not.toHaveProperty('nextRefreshAt')
    expect(db._store[PLAY_SUBSCRIPTIONS].find(row => row.purchaseReference === current)).toMatchObject({ nextRefreshAt: oldExpiry })
    await expect(service.verifySubscription('alice', TOKEN)).resolves.toMatchObject({ state: 'expired', status: 'cancelled' })

    const firstYear = `${SECOND}..0`
    advanceTo(oldExpiry)
    orders.set(firstYear, paidOrder(firstYear, oldExpiry, REPLACEMENT, 'yearly'))
    change.lineItems[0].latestSuccessfulOrderId = firstYear
    change.lineItems[0].expiryTime = '2028-02-21T00:00:00+08:00'
    await service.refreshSubscriptions(async () => {})
    await service.verifySubscription('alice', REPLACEMENT)
    expect(db._store.orders.map(order => order.transactionId)).toEqual([FIRST, firstYear])
    expect(db._store.orders.at(-1)).toMatchObject({ billingCycle: 'year', membershipGrant: { expireBefore: oldExpiry } })
    expect(db._store.user_memberships[0].expireAt).toBe(Date.parse('2028-02-21T00:00:00+08:00'))
  })

  it('supports a change that initially reports the old receipt or no order before the first new monthly charge', async () => {
    const { db, orders, play, service, snapshot, advanceTo } = fixture()
    snapshot.lineItems[0].offerDetails.basePlanId = 'yearly'
    snapshot.lineItems[0].expiryTime = '2028-01-21T00:00:00+08:00'
    orders.set(FIRST, paidOrder(FIRST, NOW, TOKEN, 'yearly'))
    await service.verifySubscription('alice', TOKEN)
    const oldExpiry = db._store.user_memberships[0].expireAt
    const change = replacementSnapshot(snapshot, null, 'monthly')
    mockReplacement(play, snapshot, change)
    await expect(service.verifySubscription('alice', REPLACEMENT)).resolves.toMatchObject({ basePlanId: 'monthly', status: 'confirmed' })
    expect(db._store.orders).toHaveLength(1)

    change.lineItems[0].latestSuccessfulOrderId = FIRST
    await expect(service.verifySubscription('alice', REPLACEMENT)).resolves.toMatchObject({ status: 'confirmed' })
    expect(db._store.orders).toHaveLength(1)

    advanceTo(oldExpiry)
    orders.set(SECOND, paidOrder(SECOND, oldExpiry, REPLACEMENT))
    change.lineItems[0].latestSuccessfulOrderId = SECOND
    change.lineItems[0].expiryTime = '2028-02-21T00:00:00+08:00'
    await expect(service.verifySubscription('alice', REPLACEMENT)).resolves.toMatchObject({ status: 'confirmed' })
    expect(db._store.orders.map(order => order.billingCycle)).toEqual(['year', 'month'])
    expect(db._store.user_memberships[0].expireAt).toBe(Date.parse('2028-02-21T00:00:00+08:00'))
  })

  it('rejects a foreign linked token and closes transferred access when the original payment is refunded', async () => {
    const { db, play, service, snapshot } = fixture()
    await service.verifySubscription('alice', TOKEN)
    const change = replacementSnapshot(snapshot, FIRST)
    mockReplacement(play, snapshot, change)
    change.externalAccountIdentifiers.obfuscatedExternalAccountId = service.capabilities('bob').accountMarker
    await expect(service.verifySubscription('bob', REPLACEMENT)).rejects.toMatchObject({ code: 'purchase_account_mismatch' })
    change.externalAccountIdentifiers.obfuscatedExternalAccountId = service.capabilities('alice').accountMarker
    await service.verifySubscription('alice', REPLACEMENT)
    const notify = push(service)
    await expect(notify({ voidedPurchaseNotification: { refundType: 1, productType: 1, orderId: FIRST, purchaseToken: TOKEN } }))
      .resolves
      .toMatchObject({ statusCode: 204 })
    expect(db._store.user_memberships[0].playSubscriptionAccess).toEqual([])
    await expect(service.entitlement('alice')).resolves.toMatchObject({ membership: { isActive: false } })
    await expect(service.verifySubscription('alice', REPLACEMENT)).resolves.toMatchObject({ status: 'cancelled' })
    expect(db._store.orders).toHaveLength(1)
  })

  it('preserves the first payment through repeated switches and ignores a competing successor', async () => {
    const { db, orders, play, service, snapshot } = fixture()
    await service.verifySubscription('alice', TOKEN)
    const next = 'fixture-play-subscription-change-119'
    const competing = 'fixture-play-subscription-change-120'
    const change = replacementSnapshot(snapshot, null)
    change.acknowledgementState = ACKNOWLEDGED
    const returnToMonthly = replacementSnapshot(change, FIRST, 'monthly')
    returnToMonthly.linkedPurchaseToken = REPLACEMENT
    const fork = replacementSnapshot(snapshot, SECOND)
    orders.set(SECOND, paidOrder(SECOND, NOW, competing, 'yearly'))
    const snapshots = new Map([[TOKEN, snapshot], [REPLACEMENT, change], [next, returnToMonthly], [competing, fork]])
    play.getSubscription.mockImplementation(async token => structuredClone(snapshots.get(token)))
    await expect(service.verifySubscription('alice', REPLACEMENT)).resolves.toMatchObject({ status: 'confirmed' })
    await expect(service.verifySubscription('alice', next)).resolves.toMatchObject({ basePlanId: 'monthly', status: 'confirmed' })
    await expect(service.verifySubscription('alice', REPLACEMENT)).resolves.toMatchObject({ status: 'cancelled' })
    await expect(service.verifySubscription('alice', competing)).rejects.toMatchObject({ code: 'purchase_account_mismatch' })
    expect(db._store.orders.map(order => order.transactionId)).toEqual([FIRST])
    expect(db._store.user_memberships[0].playSubscriptionAccess).toEqual([{
      purchaseReference: purchaseReference(next),
      paidPurchaseReference: purchaseReference(TOKEN),
      orderId: FIRST,
      expiresAt: db._store.user_memberships[0].expireAt,
    }])
  })

  it('advertises one subscription with two base plans alongside one-time purchases only when enabled', async () => {
    const off = fixture({ enabled: false })
    expect(off.service.capabilities('alice')).not.toHaveProperty('subscriptions')
    await expect(off.service.verifySubscription('alice', TOKEN)).rejects.toMatchObject({ code: 'unsupported_purchase' })
    expect(off.play.getSubscription).not.toHaveBeenCalled()

    const { service } = fixture()
    expect(service.capabilities('alice')).toMatchObject({
      subscriptions: [
        { id: SUBSCRIPTION_PRODUCT, basePlanId: 'monthly', cycle: 'month' },
        { id: SUBSCRIPTION_PRODUCT, basePlanId: 'yearly', cycle: 'year' },
      ],
      products: [{ id: 'cook_member_month' }, { id: 'cook_member_year' }],
    })
    const router = createPlayRouter({
      getCaller: () => ({ uid: 'alice' }),
      checkAccount: async () => {},
      getService: () => service,
      enabled: () => true,
    })
    await expect(router({ action: 'preparePurchase', productId: SUBSCRIPTION_PRODUCT, basePlanId: 'yearly', uid: 'bob' }))
      .resolves
      .toMatchObject({ basePlanId: 'yearly', accountMarker: service.capabilities('alice').accountMarker })
    await expect(router({ action: 'verifySubscription', purchaseToken: TOKEN, uid: 'bob' })).resolves.toMatchObject({
      productId: SUBSCRIPTION_PRODUCT,
      basePlanId: 'monthly',
      state: 'active',
      status: 'confirmed',
    })
  })

  it('acknowledges the initial payment only after the annual grant is durable and preserves existing Web time', async () => {
    const webExpiry = Date.parse('2027-01-31T00:00:00+08:00')
    const { db, orders, play, service, snapshot } = fixture({
      db: makeFakeDb({ user_memberships: [{ _id: 'alice', expireAt: webExpiry, lastOrderId: 'web' }] }),
    })
    snapshot.lineItems[0].offerDetails.basePlanId = 'yearly'
    orders.set(FIRST, paidOrder(FIRST, NOW, TOKEN, 'yearly'))
    play.acknowledgeSubscription.mockImplementation(async () => {
      expect(db._store.orders).toHaveLength(1)
      expect(db._store.orders[0]).toMatchObject({
        transactionId: FIRST,
        status: 'paid',
        billingCycle: 'year',
        membershipGrant: { expireBefore: webExpiry },
      })
      snapshot.acknowledgementState = ACKNOWLEDGED
    })
    await expect(service.verifySubscription('alice', TOKEN)).resolves.toMatchObject({ status: 'confirmed', basePlanId: 'yearly' })
    await expect(service.verifySubscription('alice', TOKEN)).resolves.toMatchObject({ status: 'confirmed' })
    expect(db._store.user_memberships[0].expireAt).toBe(Date.parse('2028-01-31T00:00:00+08:00'))
    expect(play.acknowledgeSubscription).toHaveBeenCalledExactlyOnceWith(SUBSCRIPTION_PRODUCT, TOKEN)
    expect(play.consume).not.toHaveBeenCalled()
    expect(JSON.stringify(db._store)).not.toContain(TOKEN)
  })

  it('backfills missed cycles in order from authenticated notifications after the app has closed', async () => {
    const { db, orders, play, service, snapshot } = fixture()
    await service.preparePurchase('alice', SUBSCRIPTION_PRODUCT, 'monthly')
    const ids = [FIRST, `${FIRST}..0`, `${FIRST}..1`]
    orders.set(ids[0], paidOrder(ids[0], Date.parse('2026-11-21T00:00:00+08:00')))
    orders.set(ids[1], paidOrder(ids[1], Date.parse('2026-12-21T00:00:00+08:00')))
    orders.set(ids[2], paidOrder(ids[2], NOW))
    snapshot.lineItems[0].latestSuccessfulOrderId = ids[2]
    snapshot.acknowledgementState = ACKNOWLEDGED
    const checkAccount = vi.fn()
    const notify = push(service, checkAccount)
    const renewal = { subscriptionNotification: { notificationType: 2, purchaseToken: TOKEN } }
    const results = await Promise.all([notify(renewal), notify(renewal)])
    expect(results.map(response => response.statusCode)).toEqual([204, 204])
    expect(play.getOrders).toHaveBeenCalledWith(ids)
    expect(checkAccount).toHaveBeenCalledWith('alice')
    expect(db._store.orders.map(order => order.transactionId)).toEqual(ids)
    expect(db._store.user_memberships[0].expireAt).toBe(Date.parse('2027-02-21T00:00:00+08:00'))
    expect(play.acknowledgeSubscription).not.toHaveBeenCalled()
  })

  it('resumes a long order history from the durable cursor after a failed batch', async () => {
    const { db, orders, play, service, snapshot } = fixture()
    const ids = Array.from({ length: 10 }, (_, index) => index === 0 ? FIRST : `${FIRST}..${index - 1}`)
    for (const [index, id] of ids.entries()) {
      orders.set(id, paidOrder(id, Date.UTC(2026, 3 + index, 20, 16)))
    }
    snapshot.lineItems[0].latestSuccessfulOrderId = ids.at(-1)
    snapshot.acknowledgementState = ACKNOWLEDGED
    await expect(service.verifySubscription('alice', TOKEN)).resolves.toMatchObject({ status: 'committed' })
    expect(db._store.orders).toHaveLength(8)
    play.getOrders.mockRejectedValueOnce(new Error('provider temporarily unavailable'))
    await expect(service.verifySubscription('alice', TOKEN)).rejects.toThrow('provider temporarily unavailable')
    expect(db._store.orders).toHaveLength(8)

    await expect(service.verifySubscription('alice', TOKEN)).resolves.toMatchObject({ status: 'confirmed' })
    expect(play.getOrders).toHaveBeenLastCalledWith(ids.slice(8))
    expect(db._store.orders.map(order => order.transactionId)).toEqual(ids)
    expect(db._store.user_memberships[0].expireAt).toBe(Date.parse('2027-02-21T00:00:00+08:00'))
  })

  it('keeps paid time through cancellation, grace, and a zero-price restart', async () => {
    const { db, orders, service, snapshot, advanceTo } = fixture()
    await service.verifySubscription('alice', TOKEN)
    const { expireAt: paidExpiry, lastOrderId } = db._store.user_memberships[0]
    snapshot.subscriptionState = 'SUBSCRIPTION_STATE_CANCELED'
    snapshot.lineItems[0].autoRenewingPlan.autoRenewEnabled = false
    await expect(service.verifySubscription('alice', TOKEN)).resolves.toMatchObject({ state: 'cancelled', autoRenewing: false })

    snapshot.subscriptionState = 'SUBSCRIPTION_STATE_ACTIVE'
    snapshot.lineItems[0].autoRenewingPlan.autoRenewEnabled = true
    const restart = `${FIRST}..0`
    orders.set(restart, { ...paidOrder(restart, NOW), total: { currencyCode: 'CNY' } })
    snapshot.lineItems[0].latestSuccessfulOrderId = restart
    await expect(service.verifySubscription('alice', TOKEN)).resolves.toMatchObject({ state: 'active', status: 'confirmed' })

    snapshot.subscriptionState = 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD'
    snapshot.lineItems[0].expiryTime = '2027-02-23T00:00:00+08:00'
    advanceTo(paidExpiry + 1)
    const expiry = Date.parse('2027-02-23T00:00:00+08:00')
    await expect(service.verifySubscription('alice', TOKEN)).resolves.toMatchObject({
      state: 'grace',
      periodExpiresAt: expiry,
    })
    expect(db._store.user_memberships[0]).toMatchObject({ expireAt: paidExpiry, lastOrderId })
    expect(db._store.orders).toHaveLength(1)
    await expect(service.entitlement('alice')).resolves.toMatchObject({ membership: { isActive: true, expireAt: expiry } })
    advanceTo(expiry)
    await expect(service.entitlement('alice')).resolves.toMatchObject({ membership: { isActive: false } })
  })

  it('starts a recovered renewal at the paid period, keeping the actual transaction time on the order', async () => {
    const { db, orders, service, snapshot, advanceTo } = fixture()
    await service.verifySubscription('alice', TOKEN)
    const id = `${FIRST}..0`
    const periodStart = Date.parse('2027-02-21T00:00:00+08:00')
    const chargedAt = Date.parse('2027-02-23T00:00:00+08:00')
    const periodEnd = Date.parse('2027-03-21T00:00:00+08:00')
    const renewal = paidOrder(id, chargedAt)
    renewal.lineItems[0].subscriptionDetails.servicePeriodStartTime = new Date(periodStart).toISOString()
    renewal.lineItems[0].subscriptionDetails.servicePeriodEndTime = new Date(periodEnd).toISOString()
    orders.set(id, renewal)
    snapshot.lineItems[0].latestSuccessfulOrderId = id
    snapshot.lineItems[0].expiryTime = new Date(periodEnd).toISOString()
    advanceTo(chargedAt)

    await expect(service.verifySubscription('alice', TOKEN)).resolves.toMatchObject({ status: 'confirmed' })
    await expect(service.verifySubscription('alice', TOKEN)).resolves.toMatchObject({ status: 'confirmed' })
    expect(db._store.orders).toHaveLength(2)
    expect(db._store.orders[1]).toMatchObject({ providerPurchasedAt: chargedAt })
    expect(db._store.user_memberships[0].expireAt).toBe(periodEnd)
  })

  it('removes grace on hold even if Orders is offline and an older Play response arrives later', async () => {
    const { db, play, service, snapshot, advanceTo } = fixture()
    await service.verifySubscription('alice', TOKEN)
    const paidExpiry = db._store.user_memberships[0].expireAt
    const graceExpiry = paidExpiry + 3 * 86_400_000
    advanceTo(paidExpiry + 1)
    snapshot.subscriptionState = 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD'
    snapshot.lineItems[0].expiryTime = new Date(graceExpiry).toISOString()
    await service.verifySubscription('alice', TOKEN)

    const barrier = Promise.withResolvers()
    play.getSubscription.mockReturnValueOnce(barrier.promise)
    const staleSnapshot = structuredClone(snapshot)
    const staleCheck = service.verifySubscription('alice', TOKEN)
    advanceTo(paidExpiry + 2)
    snapshot.subscriptionState = 'SUBSCRIPTION_STATE_ON_HOLD'
    play.getOrders.mockRejectedValueOnce(new Error('order API unavailable'))
    await expect(service.verifySubscription('alice', TOKEN)).rejects.toThrow('order API unavailable')
    barrier.resolve(staleSnapshot)
    await staleCheck

    expect(db._store.user_memberships[0]).toMatchObject({ expireAt: paidExpiry, playSubscriptionAccess: [] })
    await expect(service.entitlement('alice')).resolves.toMatchObject({ membership: { isActive: false, expireAt: paidExpiry } })
  })

  it('refreshes an ACTIVE subscription at renewal with no device or Play notice during silent grace', async () => {
    const { db, service, snapshot, advanceTo, play } = fixture()
    await service.preparePurchase('alice', SUBSCRIPTION_PRODUCT, 'monthly')
    await service.verifySubscription('alice', TOKEN)
    const paidExpiry = db._store.user_memberships[0].expireAt
    const scheduled = db._store[PLAY_SUBSCRIPTIONS][0]
    expect(scheduled.nextRefreshAt).toBe(paidExpiry)
    expect(scheduled.encryptedPurchaseToken).toMatch(/^v1\./)
    expect(JSON.stringify(db._store)).not.toContain(TOKEN)
    expect(JSON.stringify(db._store)).not.toContain('separate-fixture-subscription-key-2027')

    const checkAccount = vi.fn()
    play.getSubscription.mockClear()
    advanceTo(paidExpiry - 1)
    await service.refreshSubscriptions(checkAccount)
    expect(play.getSubscription).not.toHaveBeenCalled()

    advanceTo(paidExpiry)
    const checks = await Promise.all([service.refreshSubscriptions(checkAccount), service.refreshSubscriptions(checkAccount)])
    expect(checks.reduce((count, result) => count + result.processed, 0)).toBe(1)
    expect(play.getSubscription).toHaveBeenCalledExactlyOnceWith(TOKEN)
    expect(checkAccount).toHaveBeenCalledExactlyOnceWith('alice')
    expect(db._store.orders).toHaveLength(1)
    expect(db._store.user_memberships[0].expireAt).toBe(paidExpiry)
    await expect(service.entitlement('alice')).resolves.toMatchObject({ membership: { isActive: true, expireAt: paidExpiry + 120_000 } })
    expect(db._store[PLAY_SUBSCRIPTIONS][0].nextRefreshAt).toBe(paidExpiry + 60_000)

    snapshot.subscriptionState = 'SUBSCRIPTION_STATE_ON_HOLD'
    advanceTo(paidExpiry + 60_000)
    await service.refreshSubscriptions(checkAccount)
    await expect(service.entitlement('alice')).resolves.toMatchObject({ membership: { isActive: false, expireAt: paidExpiry } })
    expect(db._store[PLAY_SUBSCRIPTIONS][0]).not.toHaveProperty('encryptedPurchaseToken')
    expect(db._store[PLAY_SUBSCRIPTIONS][0]).not.toHaveProperty('nextRefreshAt')
  })

  it('retries an unavailable provider with backoff without extending the verified expiry', async () => {
    const { db, service, play, snapshot, advanceTo } = fixture({ environment: 'Sandbox' })
    await service.preparePurchase('alice', SUBSCRIPTION_PRODUCT, 'monthly')
    await service.verifySubscription('alice', TOKEN)
    const paidExpiry = db._store.play_sandbox_user_memberships[0].expireAt
    advanceTo(paidExpiry)
    play.getSubscription.mockRejectedValueOnce(new Error('provider unavailable'))
    await expect(service.refreshSubscriptions(async () => {})).resolves.toMatchObject({ retried: 1 })
    await expect(service.entitlement('alice')).resolves.toMatchObject({ membership: { isActive: false, expireAt: paidExpiry } })
    expect(db._store.play_sandbox_subscription_progress[0].nextRefreshAt).toBe(paidExpiry + 60_000)
    advanceTo(paidExpiry + 60_000)
    play.getSubscription.mockRejectedValueOnce(new Error('provider unavailable'))
    await expect(service.refreshSubscriptions(async () => {})).resolves.toMatchObject({ retried: 1 })
    expect(db._store.play_sandbox_subscription_progress[0].nextRefreshAt).toBe(paidExpiry + 180_000)

    advanceTo(paidExpiry + 180_000)
    snapshot.subscriptionState = 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD'
    const graceEndsAt = paidExpiry + 86_400_000
    snapshot.lineItems[0].expiryTime = new Date(graceEndsAt).toISOString()
    await expect(service.refreshSubscriptions(async () => {})).resolves.toMatchObject({ processed: 1 })
    await expect(service.entitlement('alice')).resolves.toMatchObject({ membership: { isActive: true, expireAt: graceEndsAt } })
    expect(db._store.play_sandbox_subscription_progress[0].nextRefreshAt).toBe(graceEndsAt)
    expect(db._store.user_memberships).toBeUndefined()
  })

  it('lets a later timer recover a lease after a stopped invocation and fences the stale response', async () => {
    const { db, service, snapshot, advanceTo, play } = fixture()
    await service.preparePurchase('alice', SUBSCRIPTION_PRODUCT, 'monthly')
    await service.verifySubscription('alice', TOKEN)
    const paidExpiry = db._store.user_memberships[0].expireAt
    advanceTo(paidExpiry)
    const staleSnapshot = structuredClone(snapshot)
    const reachedProvider = Promise.withResolvers()
    const resumeProvider = Promise.withResolvers()
    play.getSubscription.mockImplementationOnce(() => {
      reachedProvider.resolve()
      return resumeProvider.promise
    })
    const stale = service.refreshSubscriptions(async () => {})
    await reachedProvider.promise
    expect(db._store[PLAY_SUBSCRIPTIONS][0].nextRefreshAt).toBe(paidExpiry + 120_000)

    advanceTo(paidExpiry + 120_000)
    snapshot.subscriptionState = 'SUBSCRIPTION_STATE_EXPIRED'
    await service.refreshSubscriptions(async () => {})
    resumeProvider.resolve(staleSnapshot)
    await stale
    expect(db._store[PLAY_SUBSCRIPTIONS][0]).not.toHaveProperty('encryptedPurchaseToken')
    await expect(service.entitlement('alice')).resolves.toMatchObject({ membership: { isActive: false, expireAt: paidExpiry } })
  })

  it('discards an unauthentic ciphertext without sending it to Google', async () => {
    const { db, service, advanceTo, play } = fixture()
    await service.preparePurchase('alice', SUBSCRIPTION_PRODUCT, 'monthly')
    await service.verifySubscription('alice', TOKEN)
    const job = db._store[PLAY_SUBSCRIPTIONS][0]
    const [version, iv, ciphertext, tag] = job.encryptedPurchaseToken.split('.')
    const changed = `${tag[0] === 'A' ? 'B' : 'A'}${tag.slice(1)}`
    await db.collection(PLAY_SUBSCRIPTIONS).doc(job._id).update({ encryptedPurchaseToken: [version, iv, ciphertext, changed].join('.') })
    advanceTo(job.nextRefreshAt)
    play.getSubscription.mockClear()
    await expect(service.refreshSubscriptions(async () => {})).resolves.toMatchObject({ stopped: 1 })
    expect(play.getSubscription).not.toHaveBeenCalled()
    expect(db._store[PLAY_SUBSCRIPTIONS][0]).not.toHaveProperty('encryptedPurchaseToken')
  })

  it('removes the token when the provider lookup window has ended', async () => {
    const { db, service, advanceTo, play } = fixture()
    await service.preparePurchase('alice', SUBSCRIPTION_PRODUCT, 'monthly')
    await service.verifySubscription('alice', TOKEN)
    const job = db._store[PLAY_SUBSCRIPTIONS][0]
    expect(job.refreshUntil - job.nextRefreshAt).toBe(60 * 86_400_000)
    advanceTo(job.refreshUntil)
    play.getSubscription.mockClear()
    await service.refreshSubscriptions(async () => {})
    expect(play.getSubscription).not.toHaveBeenCalled()
    const progress = db._store[PLAY_SUBSCRIPTIONS][0]
    expect(progress).not.toHaveProperty('encryptedPurchaseToken')
    expect(progress).not.toHaveProperty('nextRefreshAt')
    expect(progress.paidOrderId).toBe(FIRST)
  })

  it('only allows the trusted timer to start a scheduled refresh', async () => {
    let timer = false
    let enabled = true
    const checkAccount = vi.fn()
    const refreshSubscriptions = vi.fn(async () => ({ processed: 1, retried: 0, stopped: 0, skipped: 0 }))
    const main = createRefreshHandler({
      isTimer: () => timer,
      enabled: () => enabled,
      checkAccount,
      getService: () => ({ refreshSubscriptions }),
    })
    const event = { Type: 'Timer', TriggerName: TRIGGER_NAME }
    await expect(main(event)).resolves.toEqual({ code: 'timer_required' })
    timer = true
    await expect(main({ ...event, TriggerName: 'another-timer' })).resolves.toEqual({ code: 'timer_required' })
    enabled = false
    await expect(main(event)).resolves.toEqual({ code: 'play_not_configured' })
    expect(refreshSubscriptions).not.toHaveBeenCalled()
    enabled = true
    await expect(main(event)).resolves.toMatchObject({ ok: true, processed: 1 })
    expect(refreshSubscriptions).toHaveBeenCalledExactlyOnceWith(checkAccount)
  })

  it('starts a new Web payment from paid time and keeps it when the Play grace period closes', async () => {
    const { db, service, snapshot, advanceTo } = fixture()
    await service.verifySubscription('alice', TOKEN)
    const paidExpiry = db._store.user_memberships[0].expireAt
    const webPurchasedAt = Date.parse('2027-02-22T00:00:00+08:00')
    advanceTo(webPurchasedAt)
    snapshot.subscriptionState = 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD'
    snapshot.lineItems[0].expiryTime = '2027-02-24T00:00:00+08:00'
    await service.verifySubscription('alice', TOKEN)

    const paid = await grantOrderEntitlement(db, {
      now: webPurchasedAt,
      order: { outTradeNo: 'web-order', userId: 'alice', level: 'basic', billingCycle: 'month' },
    })
    const webExpiry = Date.parse('2027-03-22T00:00:00+08:00')
    expect(paid).toMatchObject({ expireAt: webExpiry })
    snapshot.subscriptionState = 'SUBSCRIPTION_STATE_EXPIRED'
    advanceTo(webPurchasedAt + 1)
    await service.verifySubscription('alice', TOKEN)

    expect(paidExpiry).toBeLessThan(webPurchasedAt)
    expect(db._store.user_memberships[0]).toMatchObject({
      expireAt: webExpiry,
      lastOrderId: 'web-order',
      playSubscriptionAccess: [],
    })
    await expect(service.entitlement('alice')).resolves.toMatchObject({ membership: { isActive: true, expireAt: webExpiry } })
  })

  it('preserves ownership for Play Store resubscription after Google removes the expired-account proof', async () => {
    const { db, play, service, snapshot } = fixture()
    await service.preparePurchase('alice', SUBSCRIPTION_PRODUCT, 'monthly')
    snapshot.outOfAppPurchaseContext = { expiredExternalAccountIdentifiers: snapshot.externalAccountIdentifiers }
    delete snapshot.externalAccountIdentifiers
    play.acknowledgeSubscription.mockImplementation(async () => {
      delete snapshot.outOfAppPurchaseContext
      snapshot.acknowledgementState = ACKNOWLEDGED
      throw new Error('response lost')
    })
    const notify = push(service)
    await expect(notify({ subscriptionNotification: { notificationType: 4, purchaseToken: TOKEN } }))
      .resolves
      .toMatchObject({ statusCode: 204 })
    await expect(service.verifySubscription('alice', TOKEN)).resolves.toMatchObject({ status: 'confirmed' })
    await expect(service.verifySubscription('bob', TOKEN)).rejects.toMatchObject({ code: 'purchase_account_mismatch' })
    expect(db._store.orders.map(order => order.userId)).toEqual(['alice'])
  })

  it('fences a refunded renewal even if an old paid response arrives after the void', async () => {
    const { db, orders, service, snapshot } = fixture()
    await service.verifySubscription('alice', TOKEN)
    const original = { ...db._store.user_memberships[0] }
    const id = `${FIRST}..0`
    const order = paidOrder(id, NOW)
    orders.set(id, { ...order, state: 'REFUNDED' })
    const notify = push(service)
    await expect(notify({ voidedPurchaseNotification: { refundType: 1, productType: 1, orderId: id, purchaseToken: TOKEN } }))
      .resolves
      .toMatchObject({ statusCode: 204 })
    orders.set(id, order)
    snapshot.lineItems[0].latestSuccessfulOrderId = id
    await expect(service.verifySubscription('alice', TOKEN)).resolves.toMatchObject({ status: 'cancelled' })
    await expect(service.verifySubscription('alice', TOKEN)).resolves.toMatchObject({ status: 'cancelled' })
    expect(db._store.orders).toHaveLength(1)
    expect(db._store.user_memberships[0]).toMatchObject({ expireAt: original.expireAt, lastOrderId: original.lastOrderId })
  })

  it('reverts only the latest subscription payment on refund and preserves a later independent grant for review', async () => {
    const { db, orders, service, snapshot, play } = fixture()
    await service.verifySubscription('alice', TOKEN)
    const originalExpiry = db._store.user_memberships[0].expireAt
    const id = `${FIRST}..0`
    orders.set(id, paidOrder(id, NOW))
    snapshot.lineItems[0].latestSuccessfulOrderId = id
    await service.verifySubscription('alice', TOKEN)
    play.getSubscription.mockRejectedValue(new Error('subscription no longer available'))
    const notify = push(service)
    const refund = orderId => notify({ voidedPurchaseNotification: { refundType: 1, productType: 1, orderId, purchaseToken: TOKEN } })
    await expect(refund(id)).resolves.toMatchObject({ statusCode: 204 })
    expect(db._store.user_memberships[0].expireAt).toBe(originalExpiry)
    expect(db._store.user_memberships[0].playSubscriptionAccess).toEqual([])
    await db.collection('user_memberships').doc('alice').update({ lastOrderId: 'unrelated-web-payment', expireAt: originalExpiry + 1000 })
    await expect(refund(FIRST)).resolves.toMatchObject({ statusCode: 204 })
    expect(db._store.orders[0]).toMatchObject({ status: 'refunded', refundEntitlementStatus: 'manual_review_required' })
    expect(db._store.user_memberships[0].expireAt).toBe(originalExpiry + 1000)
  })

  it('routes consecutive refunds to review when rollback would restore a refunded order', async () => {
    const { db, orders, service, snapshot } = fixture()
    await service.verifySubscription('alice', TOKEN)
    const renewal = `${FIRST}..0`
    orders.set(renewal, paidOrder(renewal, NOW))
    snapshot.lineItems[0].latestSuccessfulOrderId = renewal
    await service.verifySubscription('alice', TOKEN)
    const { expireAt, lastOrderId } = db._store.user_memberships[0]
    const notify = push(service)
    const refund = orderId => notify({ voidedPurchaseNotification: { refundType: 1, productType: 1, orderId, purchaseToken: TOKEN } })

    await expect(refund(FIRST)).resolves.toMatchObject({ statusCode: 204 })
    await expect(refund(renewal)).resolves.toMatchObject({ statusCode: 204 })
    await expect(refund(renewal)).resolves.toMatchObject({ statusCode: 204 })
    expect(db._store.orders.map(order => order.refundEntitlementStatus)).toEqual([
      'manual_review_required',
      'manual_review_required',
    ])
    expect(db._store.user_memberships[0]).toMatchObject({ expireAt, lastOrderId, playSubscriptionAccess: [] })
  })

  it('checks Play test environment and order-token ownership before any membership write', async () => {
    const { db, orders, play, service, snapshot } = fixture({ environment: 'Sandbox' })
    delete snapshot.testPurchase
    await expect(service.verifySubscription('alice', TOKEN)).rejects.toMatchObject({ code: 'purchase_environment_mismatch' })
    snapshot.testPurchase = {}
    orders.set(FIRST, paidOrder(FIRST, NOW, 'another-play-subscription-token'))
    await expect(service.verifySubscription('alice', TOKEN)).rejects.toMatchObject({ code: 'invalid_play_purchase' })
    expect(play.acknowledgeSubscription).not.toHaveBeenCalled()
    expect(db._store.play_sandbox_orders || []).toHaveLength(0)
    orders.set(FIRST, paidOrder(FIRST, NOW))
    await expect(service.verifySubscription('alice', TOKEN)).resolves.toMatchObject({ status: 'confirmed', ledgerEnvironment: 'Sandbox' })
    expect(db._store.play_sandbox_subscription_progress).toHaveLength(1)
    expect(db._store.orders || []).toHaveLength(0)
    expect(db._store.user_memberships || []).toHaveLength(0)
  })

  it('uses the provider batch order and acknowledgement paths with an encoded token and fixed application', async () => {
    const request = vi.fn().mockResolvedValueOnce(new Response('{"kind":"test"}')).mockResolvedValueOnce(new Response('{"orders":[]}')).mockResolvedValueOnce(new Response(null, { status: 204 }))
    const publisher = createPublisher({ accessToken: async () => 'oauth-fixture', fetch: request })
    const token = 'encoded+/token#value'
    await publisher.getSubscription(token)
    await publisher.getOrders([FIRST, `${FIRST}..0`])
    await publisher.acknowledgeSubscription(SUBSCRIPTION_PRODUCT, token)
    const urls = request.mock.calls.map(([url]) => new URL(url))
    expect(urls[0].pathname).toBe(`/androidpublisher/v3/applications/fun.yunle.cook/purchases/subscriptionsv2/tokens/${encodeURIComponent(token)}`)
    expect(urls[1].searchParams.getAll('orderIds')).toEqual([FIRST, `${FIRST}..0`])
    expect(urls[2].pathname).toBe(`/androidpublisher/v3/applications/fun.yunle.cook/purchases/subscriptions/${SUBSCRIPTION_PRODUCT}/tokens/${encodeURIComponent(token)}:acknowledge`)
    expect(request.mock.calls[2][1]).toMatchObject({ method: 'POST', redirect: 'error', body: '{}' })
  })
})
