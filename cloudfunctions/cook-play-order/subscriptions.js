'use strict'

const { findPlayOwner } = require('./ownership')
const { PlayOrderError, assertValidToken, purchaseReference } = require('./purchase-proof')
const { PLAY_SUBSCRIPTIONS, withoutSchedule } = require('./subscription-refresh')

const SUBSCRIPTION_PRODUCT = 'cook_member_subscription'
const SUBSCRIPTION_PLANS = Object.freeze({ monthly: 'month', yearly: 'year' })
const BATCH_SIZE = 8
const RECHECK_ACCESS_MS = 2 * 60_000
const SUBSCRIPTION_STATES = {
  SUBSCRIPTION_STATE_PENDING: 'pending',
  SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED: 'cancelled',
  SUBSCRIPTION_STATE_ACTIVE: 'active',
  SUBSCRIPTION_STATE_IN_GRACE_PERIOD: 'grace',
  SUBSCRIPTION_STATE_ON_HOLD: 'hold',
  SUBSCRIPTION_STATE_PAUSED: 'paused',
  SUBSCRIPTION_STATE_CANCELED: 'cancelled',
  SUBSCRIPTION_STATE_EXPIRED: 'expired',
}
const ACKNOWLEDGED = 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED'
const AWAITING_ACK = 'ACKNOWLEDGEMENT_STATE_PENDING'

function parseOrderId(id) {
  const matched = typeof id === 'string' && /^(GPA\.\d{4}-\d{4}-\d{4}-\d{5})(?:\.\.(0|[1-9]\d{0,5}))?$/.exec(id)
  if (!matched)
    throw new PlayOrderError('invalid_play_purchase')
  return { root: matched[1], cycle: matched[2] === undefined ? 0 : Number(matched[2]) + 1 }
}

function time(value) {
  const timestamp = typeof value === 'string' ? Date.parse(value) : NaN
  return timestamp > 0 ? timestamp : null
}

function readSnapshot(value, ledgerEnvironment, previousReference) {
  if (value?.kind !== 'androidpublisher#subscriptionPurchaseV2')
    throw new PlayOrderError('invalid_play_purchase')
  const isTest = value.testPurchase !== null && typeof value.testPurchase === 'object' && !Array.isArray(value.testPurchase)
  if ((value.testPurchase != null && !isTest) || isTest !== (ledgerEnvironment === 'Sandbox'))
    throw new PlayOrderError('purchase_environment_mismatch')
  if (!Array.isArray(value.lineItems) || value.lineItems.length !== 1)
    throw new PlayOrderError('unsupported_purchase')
  const item = value.lineItems[0]
  const basePlanId = item?.offerDetails?.basePlanId
  if (item?.productId !== SUBSCRIPTION_PRODUCT || !Object.hasOwn(SUBSCRIPTION_PLANS, basePlanId)
    || item.prepaidPlan || item.autoRenewingPlan?.installmentDetails || item.offerDetails.offerId) {
    throw new PlayOrderError('unsupported_purchase')
  }
  const state = Object.hasOwn(SUBSCRIPTION_STATES, value.subscriptionState) ? SUBSCRIPTION_STATES[value.subscriptionState] : null
  const orderId = item.latestSuccessfulOrderId || null
  const periodExpiresAt = time(item.expiryTime)
  const canCarry = Boolean(value.linkedPurchaseToken || previousReference) && (!item.itemReplacement || (
    item.itemReplacement.productId === SUBSCRIPTION_PRODUCT && Object.hasOwn(SUBSCRIPTION_PLANS, item.itemReplacement.basePlanId)
    && item.itemReplacement.replacementMode === 'WITHOUT_PRORATION'
  ))
  const waiting = ['pending', 'cancelled', 'expired'].includes(state) && !orderId
  const hasPeriod = periodExpiresAt && item.autoRenewingPlan && [AWAITING_ACK, ACKNOWLEDGED].includes(value.acknowledgementState)
  if (!state || (!waiting && (!(orderId || canCarry) || !hasPeriod))) {
    throw new PlayOrderError('invalid_play_purchase')
  }
  return {
    basePlanId,
    cycle: SUBSCRIPTION_PLANS[basePlanId],
    state,
    orderId,
    periodExpiresAt,
    autoRenewing: item.autoRenewingPlan?.autoRenewEnabled === true,
    acknowledged: value.acknowledgementState === ACKNOWLEDGED,
    canCarry,
  }
}

function readOrder(value, orderId, token, now, isLinkedReceipt = () => false) {
  const item = Array.isArray(value?.lineItems) && value.lineItems.length === 1 ? value.lineItems[0] : null
  const details = item?.subscriptionDetails
  const basePlanId = details?.basePlanId
  if (value?.orderId !== orderId || (value.purchaseToken !== token && !isLinkedReceipt(value.purchaseToken, orderId)) || item?.productId !== SUBSCRIPTION_PRODUCT
    || !Object.hasOwn(SUBSCRIPTION_PLANS, basePlanId)) {
    throw new PlayOrderError('invalid_play_purchase')
  }
  assertValidToken(value.purchaseToken)
  const reference = purchaseReference(value.purchaseToken)
  if (['REFUNDED', 'CANCELED', 'PENDING', 'PENDING_REFUND'].includes(value.state))
    return { state: value.state, basePlanId, reference }
  const processedAt = time(value.orderHistory?.processedEvent?.eventTime)
  const amount = value.total
  const units = amount?.units ?? '0'
  const nanos = amount?.nanos ?? 0
  if (!['PROCESSED', 'PARTIALLY_REFUNDED'].includes(value.state) || !processedAt || processedAt > now + 60_000
    || !/^[A-Z]{3}$/.test(amount?.currencyCode) || typeof units !== 'string' || !/^\d{1,20}$/.test(units)
    || !Number.isInteger(nanos) || nanos < 0 || nanos >= 1_000_000_000) {
    throw new PlayOrderError('invalid_play_purchase')
  }
  // Restoring a cancelled subscription may create a $0 confirmation order in Play.
  if (BigInt(units) === 0n && nanos === 0)
    return { state: 'NO_CHARGE', basePlanId, reference }
  const periodStartAt = time(details.servicePeriodStartTime)
  const periodEndAt = time(details.servicePeriodEndTime)
  if (details.offerId || (details.offerPhase && details.offerPhase !== 'BASE')
    || (details.offerPhaseDetails && !details.offerPhaseDetails.baseDetails)
    || !periodStartAt || !(periodEndAt > periodStartAt)) {
    throw new PlayOrderError('unsupported_purchase')
  }
  return { state: value.state, basePlanId, reference, processedAt, periodStartAt, amount: { currencyCode: amount.currencyCode, units, nanos } }
}

function readResult(result) {
  if (result?.code)
    throw new PlayOrderError('play_unavailable')
  return Array.isArray(result?.data) ? result.data[0] : result?.data
}

function progressRef(db, reference) {
  return db.collection(PLAY_SUBSCRIPTIONS).doc(reference.slice(0, 40))
}

async function readProgress(db, reference) {
  const progress = readResult(await progressRef(db, reference).get())
  if (progress && (progress.purchaseReference !== reference || !Number.isInteger(progress.throughCycle)
    || progress.throughCycle < -1 || (progress.throughCycle < 0 && (progress.rootOrderId || !progress.previousPurchaseReference))
    || typeof progress.accountMarker !== 'string')) {
    throw new PlayOrderError('invalid_play_purchase')
  }
  return progress
}

function paidAnchor(progress) {
  return progress?.paidOrderId
    ? {
        orderId: progress.paidOrderId,
        reference: progress.paidPurchaseReference || progress.purchaseReference,
      }
    : null
}

function createSubscriptionSettlement({ db, play, context, clock, markerFor, googlePlayOrderKey, revokeOrder, settleOrder, recordRefresh }) {
  async function progressFor(snapshot, token, reference) {
    const progress = await readProgress(db, reference)
    const previous = snapshot.outOfAppPurchaseContext
    const linkedToken = snapshot.linkedPurchaseToken || previous?.expiredPurchaseToken
    let linkedReference = progress?.previousPurchaseReference
    let linked
    if (linkedToken) {
      assertValidToken(linkedToken)
      if (linkedToken === token)
        throw new PlayOrderError('invalid_play_purchase')
      const reference = purchaseReference(linkedToken)
      if (snapshot.linkedPurchaseToken) {
        if (linkedReference && linkedReference !== reference)
          throw new PlayOrderError('purchase_account_mismatch')
        linkedReference = reference
      }
      linked = await readProgress(db, reference)
    }
    else if (linkedReference) {
      linked = await readProgress(db, linkedReference)
    }
    const markers = [
      snapshot.externalAccountIdentifiers?.obfuscatedExternalAccountId,
      previous?.expiredExternalAccountIdentifiers?.obfuscatedExternalAccountId,
      progress?.accountMarker,
      linked?.accountMarker,
    ].filter(value => value != null)
    const marker = markers[0]
    if (markers.some(value => typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value) || value !== marker))
      throw new PlayOrderError('purchase_account_mismatch')
    return { marker, progress, linked: linkedReference ? linked : null, linkedReference }
  }

  async function saveProgress(reference, marker, root, cycle, paid, linkedReference, ownOrderSeen) {
    const result = await db.runTransaction(async (transaction) => {
      const current = await readProgress(transaction, reference)
      const rootChanged = Boolean(current?.rootOrderId && current.rootOrderId !== root)
      const couldChangeRoot = current?.previousPurchaseReference && current.ownOrderSeen === false && ownOrderSeen
      if (current && ((rootChanged && !couldChangeRoot) || current.accountMarker !== marker
        || (current.previousPurchaseReference && current.previousPurchaseReference !== linkedReference))) {
        throw new PlayOrderError('purchase_account_mismatch')
      }
      if (current?.replacementReference)
        return
      if (!current || rootChanged || current.throughCycle < cycle
        || (current.throughCycle === cycle && ((paid && !current.paidOrderId) || (ownOrderSeen && !current.ownOrderSeen)))) {
        const { _id, ...writable } = current || {}
        readResult(await progressRef(transaction, reference).set({
          ...writable,
          purchaseReference: reference,
          accountMarker: marker,
          rootOrderId: root,
          throughCycle: cycle,
          paidOrderId: paid?.orderId ?? null,
          ownOrderSeen: current?.ownOrderSeen === true || ownOrderSeen,
          ...(paid ? { paidPurchaseReference: paid.reference } : {}),
          ...(linkedReference ? { previousPurchaseReference: linkedReference } : {}),
        }))
      }
    })
    readResult(result)
  }

  function proof(reference, orderId) {
    return {
      purchaseReference: reference,
      orderId,
      subscription: true,
      packageName: context.packageName,
      ledgerEnvironment: context.ledgerEnvironment,
    }
  }

  async function syncSubscriptionAccess(userId, reference, { observedAt, paid, expiresAt }) {
    const result = await db.runTransaction(async (transaction) => {
      const progress = await readProgress(transaction, reference)
      if (!progress || progress.replacementReference || observedAt < progress.accessObservedAt
        || (expiresAt && observedAt === progress.accessObservedAt && progress.accessClosed)) {
        return false
      }
      if (progress.accountMarker !== markerFor(userId))
        throw new PlayOrderError('purchase_account_mismatch')

      const membershipRef = transaction.collection('user_memberships').doc(userId)
      const membership = readResult(await membershipRef.get())
      if (!membership || (membership.userId && membership.userId !== userId))
        return false

      const now = clock()
      let entry
      const recorded = paidAnchor(progress)
      if (expiresAt > now && paid && paid.orderId === recorded?.orderId && paid.reference === recorded.reference) {
        const order = readResult(await transaction.collection('orders').doc(googlePlayOrderKey(proof(paid.reference, paid.orderId))).get())
        if (order?.status === 'paid' && Number.isFinite(order.grantedAt) && order.userId === userId
          && order.transactionId === paid.orderId && order.meta?.purchaseReference === paid.reference
          && order.payType === 'google_play' && order.appId === 'cook' && order.meta?.bundleId === context.packageName
          && order.meta?.environment === context.ledgerEnvironment) {
          entry = { purchaseReference: reference, paidPurchaseReference: paid.reference, orderId: paid.orderId, expiresAt }
        }
      }
      const linkedReference = entry ? progress.previousPurchaseReference : null
      const linked = linkedReference ? await readProgress(transaction, linkedReference) : null
      if (linked && (linked.accountMarker !== progress.accountMarker || (linked.replacementReference && linked.replacementReference !== reference)))
        throw new PlayOrderError('purchase_account_mismatch')
      const source = Array.isArray(membership.playSubscriptionAccess) ? membership.playSubscriptionAccess : []
      const previous = source.find(item => item?.purchaseReference === reference)
      const entries = source.filter(item =>
        item?.purchaseReference !== reference && item?.purchaseReference !== linkedReference && item?.expiresAt > now,
      )
      if (entry)
        entries.push(entry)
      if (source.length !== entries.length || previous?.expiresAt !== entry?.expiresAt || previous?.orderId !== entry?.orderId
        || previous?.paidPurchaseReference !== entry?.paidPurchaseReference) {
        const { _id, ...writable } = membership
        readResult(await membershipRef.set({ ...writable, playSubscriptionAccess: entries }))
      }
      if (linked && !linked.replacementReference) {
        readResult(await progressRef(transaction, linkedReference).set({
          ...withoutSchedule(linked),
          replacementReference: reference,
          accessClosed: true,
          refreshClosed: true,
        }))
      }
      const { _id, ...writable } = progress
      readResult(await progressRef(transaction, reference).set({
        ...writable,
        accessObservedAt: observedAt,
        accessClosed: !expiresAt,
      }))
      return Boolean(entry)
    })
    readResult(result)
    return result
  }

  async function applyPaidCycle(userId, reference, orderId, receipt) {
    const now = clock()
    const outcome = await settleOrder(db, {
      userId,
      appId: 'cook',
      orderType: 'membership',
      payType: 'google_play',
      level: 'basic',
      planId: 'basic',
      billingCycle: SUBSCRIPTION_PLANS[receipt.basePlanId],
      amount: 0,
      status: 'pending',
      outTradeNo: googlePlayOrderKey(proof(reference, orderId)),
      transactionId: orderId,
      providerPurchasedAt: receipt.processedAt,
      meta: {
        productId: SUBSCRIPTION_PRODUCT,
        basePlanId: receipt.basePlanId,
        environment: context.ledgerEnvironment,
        bundleId: context.packageName,
        purchaseReference: reference,
        ownershipProof: 'cook-play-account-v1',
        providerAmount: receipt.amount,
        providerServicePeriodStartAt: receipt.periodStartAt,
      },
      createdAt: now,
      updatedAt: now,
    }, now, { alreadyConsumed: false })
    return !outcome.revoked
  }

  async function reconcile(userId, token, subscription, { marker, progress, linked, linkedReference }, observedAt) {
    if (marker !== markerFor(userId))
      throw new PlayOrderError('purchase_account_mismatch')
    const reference = purchaseReference(token)
    const { orderId, acknowledged, canCarry, ...status } = subscription
    const reply = { ...context, productId: SUBSCRIPTION_PRODUCT, purchaseReference: reference, ...status }
    if (progress?.replacementReference)
      return { ...reply, status: 'cancelled', state: 'expired', autoRenewing: false, periodExpiresAt: null }
    if (linked?.replacementReference && linked.replacementReference !== reference)
      throw new PlayOrderError('purchase_account_mismatch')
    const previousPaid = canCarry ? paidAnchor(linked) : null
    let paid = paidAnchor(progress) || previousPaid
    const now = clock()
    let expiresAt = null
    if (['active', 'grace', 'cancelled'].includes(subscription.state) && subscription.periodExpiresAt > now) {
      expiresAt = subscription.periodExpiresAt
    }
    else if (subscription.state === 'active' && subscription.autoRenewing && subscription.periodExpiresAt <= observedAt
      && observedAt + RECHECK_ACCESS_MS > now) {
      // A fresh ACTIVE snapshot can still carry the previous expiry during silent grace.
      expiresAt = observedAt + RECHECK_ACCESS_MS
    }
    if (!expiresAt && progress)
      await syncSubscriptionAccess(userId, reference, { observedAt, expiresAt: null })
    if (!orderId && (!paid || ['pending', 'cancelled', 'expired'].includes(subscription.state)))
      return { ...reply, status: ['cancelled', 'expired'].includes(subscription.state) ? 'cancelled' : 'pending' }

    const { root, cycle: latest } = orderId ? parseOrderId(orderId) : { root: progress?.rootOrderId ?? null, cycle: -1 }
    if (progress?.rootOrderId && root !== progress.rootOrderId && (!linked || !canCarry || progress.ownOrderSeen !== false))
      throw new PlayOrderError('invalid_play_purchase')
    const inheritedThrough = canCarry && root && linked?.rootOrderId === root ? linked.throughCycle : -1
    const recordedThrough = progress?.rootOrderId === root ? progress.throughCycle : -1
    const through = Math.max(recordedThrough, inheritedThrough)
    const from = Math.min(through + 1, latest)
    const end = Math.min(from + BATCH_SIZE - 1, latest)
    const ids = Array.from({ length: orderId ? end - from + 1 : 0 }, (_, index) => {
      const cycle = from + index
      return cycle === 0 ? root : `${root}..${cycle - 1}`
    })
    const orders = ids.length ? await play.getOrders(ids) : []
    if (!Array.isArray(orders) || orders.length !== ids.length)
      throw new PlayOrderError('invalid_play_purchase')
    const byId = new Map(orders.map(order => [order?.orderId, order]))
    function isLinkedReceipt(receiptToken, id) {
      if (!linked || !canCarry || typeof receiptToken !== 'string')
        return false
      const source = purchaseReference(receiptToken)
      return (root === linked.rootOrderId && source === linkedReference)
        || (id === previousPaid?.orderId && source === previousPaid.reference)
        || (id === paid?.orderId && source === paid.reference)
    }
    const receipts = ids.map(id => readOrder(byId.get(id), id, token, clock(), isLinkedReceipt))
    let ownOrderSeen = progress?.ownOrderSeen ?? Boolean(progress?.rootOrderId && !linkedReference)
    let latestVoided = false
    for (const [index, receipt] of receipts.entries()) {
      const id = ids[index]
      if (['PENDING', 'PENDING_REFUND'].includes(receipt.state))
        return { ...reply, status: paid ? 'committed' : 'pending' }
      ownOrderSeen ||= receipt.reference === reference
      if (['CANCELED', 'REFUNDED'].includes(receipt.state)) {
        await revokeOrder(db, proof(receipt.reference, id), clock(), true)
        latestVoided = id === orderId
      }
      else if (receipt.state !== 'NO_CHARGE') {
        const applied = await applyPaidCycle(userId, receipt.reference, id, receipt)
        if (applied && (from + index >= through || !paid))
          paid = { orderId: id, reference: receipt.reference }
        latestVoided = id === orderId && !applied
      }
      if (from + index >= through)
        await saveProgress(reference, marker, root, from + index, paid, linkedReference, ownOrderSeen)
    }
    await saveProgress(reference, marker, root, Math.max(through, end), paid, linkedReference, ownOrderSeen)
    if (end < latest)
      return { ...reply, status: 'committed' }
    if (latestVoided || !paid) {
      if (expiresAt)
        await syncSubscriptionAccess(userId, reference, { observedAt, expiresAt: null })
      return { ...reply, status: 'cancelled' }
    }

    const hasAccess = expiresAt ? await syncSubscriptionAccess(userId, reference, { observedAt, paid, expiresAt }) : false
    if (paid.reference !== reference && expiresAt && !hasAccess)
      return { ...reply, status: 'committed' }

    if (!acknowledged) {
      try {
        await play.acknowledgeSubscription(SUBSCRIPTION_PRODUCT, token)
      }
      catch {
        // An acknowledgement response may be lost after Play accepts it.
        const updated = await play.getSubscription(token).catch(() => null)
        if (updated?.acknowledgementState !== ACKNOWLEDGED)
          return { ...reply, status: 'committed' }
      }
    }
    return { ...reply, status: 'confirmed' }
  }

  function checkedSnapshot(snapshot, previousReference) {
    return readSnapshot(snapshot, context.ledgerEnvironment, previousReference)
  }

  async function reconcileAndRecord(userId, token, subscription, owner, observedAt) {
    const result = await reconcile(userId, token, subscription, owner, observedAt)
    await recordRefresh(token, observedAt, subscription, result.status)
    return result
  }

  return {
    async verify(userId, token, newBasePlanId) {
      assertValidToken(token)
      const observedAt = clock()
      const snapshot = await play.getSubscription(token)
      const owner = await progressFor(snapshot, token, purchaseReference(token))
      const subscription = checkedSnapshot(snapshot, owner.progress?.previousPurchaseReference)
      if (newBasePlanId && (owner.progress?.replacementReference || !subscription.acknowledged
        || subscription.basePlanId === newBasePlanId || !['active', 'cancelled'].includes(subscription.state)
        || subscription.periodExpiresAt <= clock())) {
        throw new PlayOrderError('subscription_change_unavailable')
      }
      const result = await reconcileAndRecord(userId, token, subscription, owner, observedAt)
      if (newBasePlanId && result.status !== 'confirmed')
        throw new PlayOrderError('subscription_change_unavailable')
      return result
    },

    async processNotice(notice, checkAccount) {
      const { kind, token, orderId } = notice
      const reference = purchaseReference(token)
      if (kind === 'subscription_voided') {
        parseOrderId(orderId)
        const existing = await revokeOrder(db, proof(reference, orderId), clock())
        if (existing !== 'unknown')
          return existing
      }
      const observedAt = clock()
      const snapshot = await play.getSubscription(token)
      let subscription
      try {
        const progress = await readProgress(db, reference)
        subscription = checkedSnapshot(snapshot, progress?.previousPurchaseReference)
      }
      catch (error) {
        if (error.code === 'purchase_environment_mismatch')
          return 'other_ledger'
        if (error.code === 'unsupported_purchase' && Array.isArray(snapshot?.lineItems)
          && snapshot.lineItems.every(item => item?.productId !== SUBSCRIPTION_PRODUCT)) {
          return 'ignored'
        }
        throw error
      }
      if (kind === 'subscription_voided') {
        const [order] = await play.getOrders([orderId])
        if (readOrder(order, orderId, token, clock()).state !== 'REFUNDED')
          return 'retry'
        return revokeOrder(db, proof(reference, orderId), clock(), true)
      }
      const owner = await progressFor(snapshot, token, reference)
      const userId = await findPlayOwner(db, owner.marker)
      if (!userId)
        return 'unregistered_owner'
      await checkAccount(userId)
      const result = await reconcileAndRecord(userId, token, subscription, owner, observedAt)
      return result.status
    },
  }
}

module.exports = { SUBSCRIPTION_PLANS, SUBSCRIPTION_PRODUCT, createSubscriptionSettlement }
