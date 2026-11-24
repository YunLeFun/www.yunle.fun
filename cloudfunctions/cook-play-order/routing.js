'use strict'

const { PLAY_OWNERS } = require('./ownership')
const { PlayOrderError } = require('./settlement')
const { PLAY_SUBSCRIPTIONS } = require('./subscription-refresh')

const SANDBOX_COLLECTIONS = Object.freeze({
  orders: 'play_sandbox_orders',
  user_memberships: 'play_sandbox_user_memberships',
  [PLAY_OWNERS]: 'play_sandbox_purchase_owners',
  play_purchase_states: 'play_sandbox_purchase_states',
  [PLAY_SUBSCRIPTIONS]: 'play_sandbox_subscription_progress',
})

function createSandboxLedger(db) {
  function collection(database, name) {
    if (!Object.hasOwn(SANDBOX_COLLECTIONS, name))
      throw new PlayOrderError('play_sandbox_collection_forbidden')
    return database.collection(SANDBOX_COLLECTIONS[name])
  }
  return Object.freeze({
    command: db.command,
    collection: name => collection(db, name),
    runTransaction: callback => db.runTransaction(transaction => callback({
      collection: name => collection(transaction, name),
    })),
  })
}

function createPlayRouter({ getCaller, checkAccount, getService, enabled, onFailure = () => {} }) {
  return async (event) => {
    try {
      const info = getCaller()
      const uid = info?.uid
      if (typeof uid !== 'string' || !uid || uid === 'anon' || info.isAnonymous === true)
        return { code: 'login_required' }
      if (!enabled())
        return { code: 'play_not_configured' }
      const action = event?.action
      if (!['getCapabilities', 'preparePurchase', 'verifyPurchase', 'verifySubscription', 'getEntitlement'].includes(action))
        return { code: 'unsupported_action' }
      await checkAccount(uid)
      const service = getService()
      if (action === 'getCapabilities')
        return service.capabilities(uid)
      if (action === 'preparePurchase')
        return await service.preparePurchase(uid, event.productId, event.basePlanId, event.replacesPurchaseToken)
      if (action === 'getEntitlement')
        return await service.entitlement(uid)
      if (action === 'verifySubscription')
        return await service.verifySubscription(uid, event.purchaseToken)
      return await service.verifyPurchase(uid, event.purchaseToken)
    }
    catch (error) {
      const code = error instanceof PlayOrderError ? error.code : 'play_unavailable'
      // Provider errors may contain an OAuth token or purchase token in the request URL.
      onFailure(code)
      return { code }
    }
  }
}

module.exports = { SANDBOX_COLLECTIONS, createPlayRouter, createSandboxLedger }
