'use strict'

const process = require('node:process')
const cloudbase = require('@cloudbase/node-sdk')

const { assertActiveAccountForUid } = require('./account-access')
const { parseSandboxUsers } = require('./lib/iap-sandbox')
const { googlePlayOrderKey, revokeGooglePlayOrder, settleGooglePlayOrder } = require('./lib/iap-settlement')
const { membershipAccessExpiry } = require('./lib/membership-access')
const { readMembership } = require('./lib/orders')
const { classifySyntheticOrderAccount } = require('./lib/synthetic-order')
const { createServiceAccountPublisher } = require('./publisher')
const { createGooglePushAuthenticator, createPlayPushRouter } = require('./push')
const { createPlayRouter, createSandboxLedger } = require('./routing')
const { PlayOrderError, createPlayOrderService } = require('./settlement')
const { createRefreshHandler } = require('./subscription-refresh')

function runtimeOptions(ledgerEnvironment) {
  const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
  const db = app.database()
  const sandbox = ledgerEnvironment === 'Sandbox'
  const callAccountApi = data => app.callFunction({ name: 'account-api', data }).then(result => result.result)
  let service
  return {
    enabled: () => process.env.COOK_PLAY_BILLING_ENABLED === 'true',
    getCaller: () => {
      try {
        return app.auth().getUserInfo()
      }
      catch {
        return null
      }
    },
    async checkAccount(uid) {
      if (sandbox) {
        let users
        try {
          users = parseSandboxUsers(process.env.COOK_PLAY_SANDBOX_UIDS)
        }
        catch {
          throw new PlayOrderError('play_not_configured')
        }
        if (!users.includes(uid))
          throw new PlayOrderError('play_sandbox_account_forbidden')
      }
      await assertActiveAccountForUid(callAccountApi, {
        serviceToken: process.env.ACCOUNT_API_INTERNAL_TOKEN,
        userId: uid,
      })
      if (!sandbox && (await classifySyntheticOrderAccount(db, uid)).synthetic)
        throw new PlayOrderError('play_account_forbidden')
    },
    getService() {
      service ??= createPlayOrderService({
        db: sandbox ? createSandboxLedger(db) : db,
        play: createServiceAccountPublisher(process.env.COOK_PLAY_SERVICE_ACCOUNT_JSON),
        key: process.env.COOK_PLAY_ACCOUNT_KEY,
        ledgerEnvironment,
        readMembership,
        membershipAccessExpiry,
        googlePlayOrderKey,
        revokeGooglePlayOrder,
        settleGooglePlayOrder,
        subscriptionsEnabled: process.env.COOK_PLAY_SUBSCRIPTIONS_ENABLED === 'true',
      })
      return service
    },
    onFailure: code => console.warn('[cook-play-order]', code),
  }
}

function createRuntime(ledgerEnvironment) {
  return createPlayRouter(runtimeOptions(ledgerEnvironment))
}

function createPushRuntime(ledgerEnvironment) {
  const options = runtimeOptions(ledgerEnvironment)
  let handler
  return async (event) => {
    if (!handler) {
      try {
        const { OAuth2Client } = require('google-auth-library')
        const client = new OAuth2Client()
        handler = createPlayPushRouter({
          ...options,
          subscription: process.env.COOK_PLAY_PUSH_SUBSCRIPTION,
          authenticate: createGooglePushAuthenticator({
            audience: process.env.COOK_PLAY_PUSH_AUDIENCE,
            serviceAccount: process.env.COOK_PLAY_PUSH_SERVICE_ACCOUNT,
            verifyIdToken: request => client.verifyIdToken(request),
          }),
          onStatus: status => console.warn('[cook-play-notify]', status),
        })
      }
      catch {
        return { statusCode: 503, isBase64Encoded: false, body: '' }
      }
    }
    return handler(event)
  }
}

function createRefreshRuntime(ledgerEnvironment) {
  const options = runtimeOptions(ledgerEnvironment)
  return createRefreshHandler({
    ...options,
    enabled: () => options.enabled() && process.env.COOK_PLAY_SUBSCRIPTIONS_ENABLED === 'true',
    isTimer: () => process.env.TRIGGER_SRC?.toLowerCase() === 'timer',
    onFailure: code => console.warn('[cook-play-refresh]', code),
  })
}

module.exports = { createPushRuntime, createRefreshRuntime, createRuntime }
