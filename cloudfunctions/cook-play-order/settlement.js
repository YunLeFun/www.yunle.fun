/** Cook's Google Play member passes and subscriptions. */
'use strict'

const { createHmac } = require('node:crypto')
const { findPlayOwner, registerPlayOwner } = require('./ownership')
const { PACKAGE, PlayOrderError, assertValidToken, purchaseReference } = require('./purchase-proof')
const { createSubscriptionRefresh } = require('./subscription-refresh')
const { SUBSCRIPTION_PRODUCT, SUBSCRIPTION_PLANS, createSubscriptionSettlement } = require('./subscriptions')

const PRODUCTS = Object.freeze({
  cook_member_month: 'month',
  cook_member_year: 'year',
})

function accountMarker(userId, key, ledgerEnvironment) {
  return createHmac('sha256', key)
    .update(`fun.yunle.cook.play-owner.v1\0${ledgerEnvironment}\0${userId}`)
    .digest('hex')
}

function assertLedger(value, ledgerEnvironment) {
  const isTest = value?.testPurchaseContext?.fopType === 'TEST'
  if (!value || (Object.hasOwn(value, 'testPurchaseContext') && !isTest)
    || isTest !== (ledgerEnvironment === 'Sandbox')) {
    throw new PlayOrderError('purchase_environment_mismatch')
  }
}

function readProduct(value) {
  if (!Array.isArray(value.productLineItem) || value.productLineItem.length !== 1)
    throw new PlayOrderError('unsupported_purchase')
  const { productId, productOfferDetails: offer } = value.productLineItem[0] || {}
  if (typeof productId !== 'string' || !Object.hasOwn(PRODUCTS, productId) || offer?.purchaseOptionId !== 'buy'
    || offer.rentOfferDetails || offer.preorderOfferDetails || offer.quantity !== 1) {
    throw new PlayOrderError('unsupported_purchase')
  }
  return { productId, offer }
}

function validOrderId(value) {
  return typeof value === 'string' && /^GPA\.[0-9.-]{5,100}$/.test(value)
}

function trustedPurchase(value, expectedAccount, ledgerEnvironment, now) {
  assertLedger(value, ledgerEnvironment)
  if (value.obfuscatedExternalAccountId !== expectedAccount)
    throw new PlayOrderError('purchase_account_mismatch')
  const { productId, offer } = readProduct(value)
  const state = value.purchaseStateContext?.purchaseState
  if (state === 'PENDING' || state === 'CANCELLED')
    return { state, productId }
  const providerPurchasedAt = typeof value.purchaseCompletionTime === 'string'
    ? Date.parse(value.purchaseCompletionTime)
    : NaN
  if (state !== 'PURCHASED' || !Number.isFinite(providerPurchasedAt) || providerPurchasedAt <= 0
    || providerPurchasedAt > now + 60_000 || !validOrderId(value.orderId)
    || !['CONSUMPTION_STATE_YET_TO_BE_CONSUMED', 'CONSUMPTION_STATE_CONSUMED'].includes(offer.consumptionState)) {
    throw new PlayOrderError('invalid_play_purchase')
  }
  if (offer.refundableQuantity !== 1)
    throw new PlayOrderError('purchase_unavailable')
  return {
    state,
    productId,
    orderId: value.orderId,
    providerPurchasedAt,
    alreadyConsumed: offer.consumptionState === 'CONSUMPTION_STATE_CONSUMED',
  }
}

function createPlayOrderService({
  db,
  play,
  key,
  ledgerEnvironment,
  readMembership,
  membershipAccessExpiry,
  revokeGooglePlayOrder,
  settleGooglePlayOrder,
  googlePlayOrderKey,
  subscriptionsEnabled = false,
  clock = Date.now,
}) {
  if (typeof key !== 'string' || key.length < 32 || !['Production', 'Sandbox'].includes(ledgerEnvironment))
    throw new PlayOrderError('play_not_configured')

  const context = { application: 'cook', packageName: PACKAGE, ledgerEnvironment }
  const refresh = subscriptionsEnabled ? createSubscriptionRefresh({ db, key, ledgerEnvironment, clock }) : null
  const subscriptions = refresh
    ? createSubscriptionSettlement({
        db,
        play,
        context,
        clock,
        markerFor: userId => accountMarker(userId, key, ledgerEnvironment),
        googlePlayOrderKey,
        revokeOrder: revokeGooglePlayOrder,
        settleOrder: settleGooglePlayOrder,
        recordRefresh: refresh.record,
      })
    : null

  async function reconcile(userId, token, snapshot) {
    const now = clock()
    const expectedAccount = accountMarker(userId, key, ledgerEnvironment)
    const purchase = trustedPurchase(snapshot, expectedAccount, ledgerEnvironment, now)
    const reference = purchaseReference(token)
    const reply = { ...context, productId: purchase.productId, purchaseReference: reference }
    if (purchase.state !== 'PURCHASED')
      return { ...reply, status: purchase.state === 'PENDING' ? 'pending' : 'cancelled' }

    const outTradeNo = `play_${reference.slice(0, 40)}`
    const outcome = await settleGooglePlayOrder(db, {
      userId,
      appId: 'cook',
      orderType: 'membership',
      payType: 'google_play',
      level: 'basic',
      planId: 'basic',
      billingCycle: PRODUCTS[purchase.productId],
      amount: 0,
      status: 'pending',
      outTradeNo,
      transactionId: purchase.orderId,
      providerPurchasedAt: purchase.providerPurchasedAt,
      meta: {
        productId: purchase.productId,
        environment: ledgerEnvironment,
        bundleId: PACKAGE,
        purchaseReference: reference,
        ownershipProof: 'cook-play-account-v1',
      },
      createdAt: now,
      updatedAt: now,
    }, now, purchase)
    if (outcome.revoked)
      return { ...reply, status: 'cancelled' }

    if (!purchase.alreadyConsumed) {
      try {
        // Google acknowledges a one-time product when consumed. The durable
        // ledger receipt must exist before this call, including on replay.
        await play.consume(purchase.productId, token)
      }
      catch {
        // A concurrent consume or a lost Google response is safe to recheck.
        let updated
        try {
          updated = await play.getPurchase(token)
        }
        catch {
          return { ...reply, status: 'committed' }
        }
        const replay = trustedPurchase(updated, expectedAccount, ledgerEnvironment, clock())
        if (!replay.alreadyConsumed || replay.productId !== purchase.productId || replay.orderId !== purchase.orderId)
          return { ...reply, status: 'committed' }
      }
    }
    return { ...reply, status: 'confirmed' }
  }

  function refund(token, orderId, recordWhenMissing) {
    return revokeGooglePlayOrder(db, {
      purchaseReference: purchaseReference(token),
      packageName: PACKAGE,
      ledgerEnvironment,
      orderId,
    }, clock(), recordWhenMissing)
  }

  return {
    capabilities(userId) {
      return {
        ...context,
        accountMarker: accountMarker(userId, key, ledgerEnvironment),
        products: Object.entries(PRODUCTS).map(([id, cycle]) => ({ id, cycle, purchaseOptionId: 'buy' })),
        ...(subscriptions
          ? {
              subscriptions: Object.entries(SUBSCRIPTION_PLANS).map(([basePlanId, cycle]) => ({
                id: SUBSCRIPTION_PRODUCT,
                basePlanId,
                cycle,
              })),
            }
          : {}),
      }
    },

    async preparePurchase(userId, productId, basePlanId, replacesPurchaseToken) {
      const oneTime = typeof productId === 'string' && Object.hasOwn(PRODUCTS, productId) && basePlanId === undefined
      const subscription = subscriptions && productId === SUBSCRIPTION_PRODUCT
        && typeof basePlanId === 'string' && Object.hasOwn(SUBSCRIPTION_PLANS, basePlanId)
      if (!oneTime && !subscription)
        throw new PlayOrderError('unsupported_purchase')
      if (replacesPurchaseToken !== undefined) {
        if (!subscription)
          throw new PlayOrderError('unsupported_purchase')
        await subscriptions.verify(userId, replacesPurchaseToken, basePlanId)
      }
      const marker = accountMarker(userId, key, ledgerEnvironment)
      await registerPlayOwner(db, marker, userId, clock())
      return {
        ...context,
        productId,
        accountMarker: marker,
        ...(subscription ? { basePlanId } : {}),
        ...(replacesPurchaseToken !== undefined ? { replacementMode: 'WITHOUT_PRORATION' } : {}),
      }
    },

    async entitlement(userId) {
      const record = await readMembership(db, userId)
      const expireAt = membershipAccessExpiry(record)
      return { ...context, membership: { isActive: expireAt > clock(), expireAt } }
    },

    async verifyPurchase(userId, token) {
      assertValidToken(token)
      return reconcile(userId, token, await play.getPurchase(token))
    },

    async verifySubscription(userId, token) {
      if (!subscriptions)
        throw new PlayOrderError('unsupported_purchase')
      return subscriptions.verify(userId, token)
    },

    async refreshSubscriptions(checkAccount) {
      if (!refresh)
        throw new PlayOrderError('unsupported_purchase')
      return refresh.run(token => subscriptions.processNotice({ kind: 'subscription', token }, checkAccount))
    },

    async processNotification(notice, checkAccount) {
      const { kind, token } = notice
      assertValidToken(token)
      if (kind === 'subscription' || kind === 'subscription_voided') {
        return subscriptions ? subscriptions.processNotice(notice, checkAccount) : 'ignored'
      }
      // A verified full-refund push plus the exact existing order can be
      // applied even if Google no longer serves the consumed receipt.
      if (kind === 'voided') {
        if (!validOrderId(notice.orderId))
          throw new PlayOrderError('invalid_play_purchase')
        const outcome = await refund(token, notice.orderId, false)
        if (outcome !== 'unknown')
          return outcome
      }

      const snapshot = await play.getPurchase(token)
      try {
        assertLedger(snapshot, ledgerEnvironment)
      }
      catch (error) {
        if (error.code === 'purchase_environment_mismatch')
          return 'other_ledger'
        throw error
      }
      const { productId, offer } = readProduct(snapshot)
      if (notice.productId && productId !== notice.productId)
        throw new PlayOrderError('unsupported_purchase')
      if (kind === 'voided') {
        if (snapshot.orderId !== notice.orderId)
          throw new PlayOrderError('invalid_play_purchase')
        return refund(token, notice.orderId, true)
      }

      const status = snapshot.purchaseStateContext?.purchaseState
      if (status === 'CANCELLED' || (status === 'PURCHASED' && offer.refundableQuantity === 0)) {
        return validOrderId(snapshot.orderId) ? refund(token, snapshot.orderId, true) : 'cancelled'
      }
      if (status === 'PENDING' || kind === 'cancelled')
        return 'retry'
      const uid = await findPlayOwner(db, snapshot.obfuscatedExternalAccountId)
      if (!uid)
        return 'unregistered_owner'
      await checkAccount(uid)
      const result = await reconcile(uid, token, snapshot)
      return result.status
    },
  }
}

module.exports = { PACKAGE, PRODUCTS, PlayOrderError, createPlayOrderService }
