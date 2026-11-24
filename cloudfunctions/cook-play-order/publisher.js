'use strict'

const { PACKAGE, PlayOrderError } = require('./purchase-proof')

const SCOPE = 'https://www.googleapis.com/auth/androidpublisher'
const APP_URL = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`

function createPublisher({ accessToken, fetch: request = fetch }) {
  async function send(path, method, body) {
    let response
    try {
      const token = await accessToken()
      if (!token)
        throw new Error('missing access token')
      response = await request(APP_URL + path, {
        method,
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body,
        signal: AbortSignal.timeout(12_000),
      })
    }
    catch {
      throw new PlayOrderError('play_unavailable')
    }
    if (response.status === 404 || response.status === 410)
      throw new PlayOrderError('purchase_unavailable')
    if (!response.ok)
      throw new PlayOrderError('play_unavailable')
    return response
  }

  async function getJson(path) {
    const response = await send(path, 'GET')
    try {
      return await response.json()
    }
    catch {
      throw new PlayOrderError('play_unavailable')
    }
  }

  return {
    getPurchase: token => getJson(`/purchases/productsv2/tokens/${encodeURIComponent(token)}`),
    async consume(productId, token) {
      await send(`/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}:consume`, 'POST')
    },
    getSubscription: token => getJson(`/purchases/subscriptionsv2/tokens/${encodeURIComponent(token)}`),
    async getOrders(ids) {
      const query = new URLSearchParams(ids.map(id => ['orderIds', id]))
      const reply = await getJson(`/orders:batchGet?${query}`)
      return reply?.orders
    },
    async acknowledgeSubscription(productId, token) {
      await send(`/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(token)}:acknowledge`, 'POST', '{}')
    },
  }
}

function createServiceAccountPublisher(raw) {
  let key
  try {
    key = JSON.parse(raw)
  }
  catch {
    throw new PlayOrderError('play_not_configured')
  }
  if (key?.type !== 'service_account' || typeof key.client_email !== 'string' || typeof key.private_key !== 'string')
    throw new PlayOrderError('play_not_configured')
  const { JWT } = require('google-auth-library')
  const auth = new JWT({ email: key.client_email, key: key.private_key, scopes: [SCOPE] })
  return createPublisher({ accessToken: async () => (await auth.getAccessToken()).token })
}

module.exports = { createPublisher, createServiceAccountPublisher }
