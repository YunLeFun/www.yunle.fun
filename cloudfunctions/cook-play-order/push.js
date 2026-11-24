'use strict'

const { Buffer } = require('node:buffer')
const { PACKAGE, PRODUCTS } = require('./settlement')

const MAX_BODY = 64 * 1024
const SUBSCRIPTION_UPDATE_TYPES = new Set([1, 2, 3, 4, 5, 6, 7, 9, 10, 12, 13, 17, 20, 21])

function reply(statusCode) {
  return { statusCode, isBase64Encoded: false, body: '' }
}

function readData(encoded) {
  if (typeof encoded !== 'string' || !encoded.length || encoded.length > MAX_BODY
    || encoded.length % 4 !== 0 || !/^[A-Z0-9+/]*={0,2}$/i.test(encoded)) {
    throw new Error('Invalid Pub/Sub data')
  }
  return Buffer.from(encoded, 'base64').toString('utf8')
}

function parseNotification(event, subscription) {
  const raw = event.isBase64Encoded === true ? readData(event.body) : event.body
  if (typeof raw === 'string' && raw.length > MAX_BODY)
    throw new Error('Oversized Pub/Sub body')
  const envelope = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (envelope?.subscription !== subscription)
    throw new Error('Unexpected Pub/Sub subscription')
  const data = JSON.parse(readData(envelope.message?.data))
  if (data?.packageName !== PACKAGE)
    return null
  const oneTime = data.oneTimeProductNotification
  const renewal = data.subscriptionNotification
  const voided = data.voidedPurchaseNotification
  if ([oneTime, renewal, voided].filter(Boolean).length > 1)
    throw new Error('Ambiguous Play notification')
  if (oneTime && typeof oneTime.sku === 'string' && Object.hasOwn(PRODUCTS, oneTime.sku)) {
    const kind = { 1: 'purchased', 2: 'cancelled' }[oneTime.notificationType]
    if (typeof oneTime.notificationType === 'number' && kind)
      return { kind, token: oneTime.purchaseToken, productId: oneTime.sku }
  }
  if (SUBSCRIPTION_UPDATE_TYPES.has(renewal?.notificationType))
    return { kind: 'subscription', token: renewal.purchaseToken }
  if (voided?.refundType === 1 && (voided.productType === 1 || voided.productType === 2)) {
    return {
      kind: voided.productType === 1 ? 'subscription_voided' : 'voided',
      token: voided.purchaseToken,
      orderId: voided.orderId,
    }
  }
  return null
}

function createGooglePushAuthenticator({ audience, serviceAccount, verifyIdToken }) {
  if (typeof audience !== 'string' || !audience || typeof serviceAccount !== 'string' || !serviceAccount)
    throw new Error('Play notification authentication is not configured')
  return async (headers) => {
    const values = Object.entries(headers || {}).filter(([name]) => name.toLowerCase() === 'authorization')
    const header = values.length === 1 ? values[0][1] : null
    const match = typeof header === 'string' && header.length <= 8192
      ? /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/i.exec(header)
      : null
    if (!match)
      return false
    try {
      const ticket = await verifyIdToken({ idToken: match[1], audience })
      const claims = ticket.getPayload()
      return claims?.email_verified === true && claims.email === serviceAccount
    }
    catch {
      return false
    }
  }
}

function createPlayPushRouter({ subscription, authenticate, enabled, getService, checkAccount, onStatus = () => {} }) {
  if (typeof subscription !== 'string' || !/^projects\/[^/]+\/subscriptions\/[^/]+$/.test(subscription))
    throw new Error('Play notification subscription is not configured')
  return async (event) => {
    if (event?.httpMethod !== 'POST')
      return reply(405)
    if (!await authenticate(event.headers))
      return reply(401)
    if (!enabled())
      return reply(503)

    let notice
    try {
      notice = parseNotification(event, subscription)
    }
    catch {
      return reply(400)
    }
    if (!notice)
      return reply(204)
    try {
      const outcome = await getService().processNotification(notice, checkAccount)
      if (outcome === 'manual_review_required' || outcome === 'unregistered_owner')
        onStatus(outcome)
      return reply(['committed', 'pending', 'retry'].includes(outcome) ? 503 : 204)
    }
    catch (error) {
      if (['invalid_purchase_token', 'invalid_play_purchase', 'unsupported_purchase'].includes(error?.code))
        return reply(400)
      onStatus('retry')
      return reply(503)
    }
  }
}

module.exports = { createGooglePushAuthenticator, createPlayPushRouter }
