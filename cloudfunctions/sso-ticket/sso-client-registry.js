/** CloudBase adapter for the shared authorization Client Registry. */

'use strict'

const {
  AuthorizationError,
  createAuthorizationCore,
  developmentRegistry,
  productionRegistry,
} = require('@yunlefun/authorization-core')

class SsoClientRegistryError extends Error {
  constructor(reason, message = reason) {
    super(message)
    this.name = 'SsoClientRegistryError'
    this.reason = reason
  }
}

function mapReason(error) {
  if (!(error instanceof AuthorizationError))
    return new SsoClientRegistryError('registry_unavailable')
  const reason = error.code === 'redirect_uri_not_allowed'
    ? 'return_url_not_allowed'
    : error.code
  return new SsoClientRegistryError(reason)
}

function createSsoClientRegistry(options = {}) {
  const snapshot = options.issuerEnvironment === 'development'
    ? developmentRegistry
    : productionRegistry
  const authorization = createAuthorizationCore({ registry: snapshot })

  return {
    allowsOrigin(origin) {
      return authorization.allowsOrigin({ adapter: 'web-sso', origin })
    },

    authorize(input) {
      if (!input?.clientId)
        throw new SsoClientRegistryError('client_required')
      try {
        const decision = authorization.authorize({
          issuer: snapshot.issuer,
          clientId: input.clientId,
          adapter: 'web-sso',
          requestedScopes: Array.isArray(input.scopes) ? input.scopes : [],
          origin: input.origin,
          redirectUri: input.returnUrl,
        })
        return Object.freeze({
          ...decision,
          origin: input.origin,
          returnUrl: input.returnUrl,
        })
      }
      catch (error) {
        throw mapReason(error)
      }
    },
  }
}

module.exports = {
  SsoClientRegistryError,
  createSsoClientRegistry,
}
