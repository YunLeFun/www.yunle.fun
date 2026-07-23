/** CloudBase adapter for the shared desktop Client Registry. */

'use strict'

const {
  AuthorizationError,
  createAuthorizationCore,
  developmentRegistry,
  productionRegistry,
} = require('@yunlefun/authorization-core')

function createDesktopClientRegistry(options = {}) {
  const snapshot = options.issuerEnvironment === 'development'
    ? developmentRegistry
    : productionRegistry
  const authorization = createAuthorizationCore({ registry: snapshot })

  return {
    issuer: snapshot.issuer,

    authorize(input) {
      if (!input?.clientId)
        throw new AuthorizationError('client_required')
      return authorization.authorize({
        issuer: snapshot.issuer,
        clientId: input.clientId,
        adapter: 'device',
        requestedScopes: Array.isArray(input.scopes) ? input.scopes : [],
      })
    },

    reauthorize(record) {
      const decision = this.authorize({
        clientId: record.clientId,
        scopes: record.scopes,
      })
      if (decision.appId !== record.appId
        || decision.registrationFingerprint !== record.registrationFingerprint) {
        throw new AuthorizationError('client_policy_changed')
      }
      return decision
    },
  }
}

module.exports = {
  createDesktopClientRegistry,
}
