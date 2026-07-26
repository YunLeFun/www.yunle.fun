import type {
  AuthorizationAdapter,
  ClientRegistration,
  ClientRegistrySnapshot,
  ConsentMode,
} from './registry-types'
import { createHash } from 'node:crypto'

export interface AuthorizationRequest {
  issuer: string
  clientId: string
  adapter: AuthorizationAdapter
  requestedScopes: readonly string[]
  origin?: string
  redirectUri?: string
}

export interface AuthorizationDecision {
  issuer: string
  clientId: string
  appId: string
  displayName: string
  adapter: AuthorizationAdapter
  consent: ConsentMode
  scopes: string[]
  policyVersion: string
  registrationFingerprint: string
}

export interface AuthorizationCore {
  authorize: (request: AuthorizationRequest) => AuthorizationDecision
  allowsOrigin: (request: { adapter: AuthorizationAdapter, origin: string }) => boolean
}

export interface CreateAuthorizationCoreOptions {
  registry: ClientRegistrySnapshot
}

export class AuthorizationError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = 'AuthorizationError'
    this.code = code
  }
}

/**
 * Creates the authorization policy interface used by protocol adapters.
 *
 * The caller supplies only protocol request facts. Business attribution and
 * allowed scopes always come from the versioned registry.
 */
export function createAuthorizationCore(options: CreateAuthorizationCoreOptions): AuthorizationCore {
  const registry = options.registry
  const clients = new Map<string, ClientRegistration>()
  for (const client of registry.clients) {
    if (clients.has(client.clientId))
      throw new AuthorizationError('registry_invalid')
    clients.set(client.clientId, client)
  }

  return {
    allowsOrigin(request) {
      return [...clients.values()].some(client =>
        client.status === 'active'
        && client.adapters.some(adapter =>
          adapter.kind === request.adapter
          && adapter.origins?.includes(request.origin),
        ),
      )
    },

    authorize(request) {
      if (request.issuer !== registry.issuer)
        throw new AuthorizationError('issuer_mismatch')

      const client = clients.get(request.clientId)
      if (!client)
        throw new AuthorizationError('client_unknown')
      if (client.status !== 'active')
        throw new AuthorizationError('client_unavailable')

      const adapter = client.adapters.find(candidate => candidate.kind === request.adapter)
      if (!adapter)
        throw new AuthorizationError('adapter_not_allowed')

      if (adapter.kind === 'web-sso') {
        if (!request.origin || !adapter.origins?.includes(request.origin))
          throw new AuthorizationError('origin_not_allowed')
        if (!request.redirectUri || !adapter.redirectUris?.includes(request.redirectUri))
          throw new AuthorizationError('redirect_uri_not_allowed')
      }

      if (!request.requestedScopes.length)
        throw new AuthorizationError('invalid_scope')

      const scopes = [...new Set(request.requestedScopes)]
      if (scopes.some(scope => !adapter.allowedScopes.includes(scope)))
        throw new AuthorizationError('invalid_scope')

      return {
        issuer: registry.issuer,
        clientId: client.clientId,
        appId: client.appId,
        displayName: client.displayName,
        adapter: adapter.kind,
        consent: adapter.consent,
        scopes,
        policyVersion: registry.policyVersion,
        registrationFingerprint: createHash('sha256').update(JSON.stringify({
          adapter: adapter.kind,
          allowedScopes: [...adapter.allowedScopes].sort(),
          appId: client.appId,
          clientId: client.clientId,
          consent: adapter.consent,
          issuer: registry.issuer,
          status: client.status,
        })).digest('hex'),
      }
    },
  }
}

export { createDeviceGrantMachine } from './device-grant'
export type {
  DeviceAuthorizationRecord,
  DeviceGrant,
} from './device-grant'
export { createEntitlementKeyring } from './entitlement'
export type { EntitlementClaims } from './entitlement'
export {
  createProofOfPossessionVerifier,
  deviceJwkThumbprint,
} from './proof-of-possession'
export type {
  DevicePublicJwk,
  VerifiedProof,
} from './proof-of-possession'
export { createRefreshGrantMachine } from './refresh-grant'
export type { RefreshTokenRecord } from './refresh-grant'
export {
  developmentRegistry,
  issuerCatalog,
  productionRegistry,
} from './registry'
export type {
  AuthorizationAdapter,
  ClientAdapterRegistration,
  ClientRegistration,
  ClientRegistrySnapshot,
  ConsentMode,
} from './registry-types'
export { createWebSsoCodeMachine } from './web-sso-code'
export type {
  ConsumeWebSsoCodeInput,
  IssueWebSsoCodeInput,
  WebSsoCodeRecord,
} from './web-sso-code'
