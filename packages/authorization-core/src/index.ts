import type {
  AuthorizationAdapter,
  ClientAdapterRegistration,
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

interface IndexedAdapter {
  registration: ClientAdapterRegistration
  allowedScopes: ReadonlySet<string>
  origins: ReadonlySet<string>
  redirectUris: ReadonlySet<string>
  registrationFingerprint: string
}

interface IndexedClient {
  registration: ClientRegistration
  adapters: ReadonlyMap<AuthorizationAdapter, IndexedAdapter>
}

/**
 * Creates the authorization policy interface used by protocol adapters.
 *
 * The caller supplies only protocol request facts. Business attribution and
 * allowed scopes always come from the versioned registry.
 */
export function createAuthorizationCore(options: CreateAuthorizationCoreOptions): AuthorizationCore {
  const registry = options.registry
  const clients = new Map<string, IndexedClient>()
  const activeOrigins = new Map<AuthorizationAdapter, Set<string>>()
  for (const client of registry.clients) {
    if (clients.has(client.clientId))
      throw new AuthorizationError('registry_invalid')
    const adapters = new Map<AuthorizationAdapter, IndexedAdapter>()
    for (const adapter of client.adapters) {
      if (adapters.has(adapter.kind))
        throw new AuthorizationError('registry_invalid')
      const origins = new Set(adapter.origins ?? [])
      const indexedAdapter: IndexedAdapter = {
        registration: adapter,
        allowedScopes: new Set(adapter.allowedScopes),
        origins,
        redirectUris: new Set(adapter.redirectUris ?? []),
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
      adapters.set(adapter.kind, indexedAdapter)
      if (client.status === 'active') {
        const adapterOrigins = activeOrigins.get(adapter.kind) ?? new Set<string>()
        for (const origin of origins)
          adapterOrigins.add(origin)
        activeOrigins.set(adapter.kind, adapterOrigins)
      }
    }
    clients.set(client.clientId, { registration: client, adapters })
  }

  return {
    allowsOrigin(request) {
      return activeOrigins.get(request.adapter)?.has(request.origin) ?? false
    },

    authorize(request) {
      if (request.issuer !== registry.issuer)
        throw new AuthorizationError('issuer_mismatch')

      const indexedClient = clients.get(request.clientId)
      if (!indexedClient)
        throw new AuthorizationError('client_unknown')
      const client = indexedClient.registration
      if (client.status !== 'active')
        throw new AuthorizationError('client_unavailable')

      const indexedAdapter = indexedClient.adapters.get(request.adapter)
      if (!indexedAdapter)
        throw new AuthorizationError('adapter_not_allowed')
      const adapter = indexedAdapter.registration

      if (adapter.kind === 'web-sso') {
        if (!request.origin || !indexedAdapter.origins.has(request.origin))
          throw new AuthorizationError('origin_not_allowed')
        if (!request.redirectUri || !indexedAdapter.redirectUris.has(request.redirectUri))
          throw new AuthorizationError('redirect_uri_not_allowed')
      }

      if (!request.requestedScopes.length)
        throw new AuthorizationError('invalid_scope')

      const scopes = [...new Set(request.requestedScopes)]
      if (scopes.some(scope => !indexedAdapter.allowedScopes.has(scope)))
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
        registrationFingerprint: indexedAdapter.registrationFingerprint,
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
export { createIdentityAssertionKeyring } from './identity-assertion'
export type {
  IdentityAssertionClaims,
  IdentityAssertionKeyInput,
  IdentityAssertionKeyring,
  IdentityAssertionKeyringOptions,
  SignIdentityAssertionInput,
  VerifyIdentityAssertionInput,
} from './identity-assertion'
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
  developmentRegistryArtifact,
  productionRegistry,
  productionRegistryArtifact,
} from './registry'
export {
  canonicalJson,
  canonicalRegistryJson,
  hashRegistry,
} from './registry-canonical'
export {
  parseClientRegistrySnapshot,
  parseGeneratedRegistryArtifact,
  parseRegistrySnapshotRecord,
  RegistryValidationError,
} from './registry-schema'
export {
  signRegistryActivation,
  signRegistrySnapshot,
  verifyRegistryActiveEnvelope,
  verifyRegistrySnapshotSignature,
} from './registry-signature'
export type { RegistryKeyInput } from './registry-signature'
export { hasRegistryTrustAnchor, registryTrustAnchors } from './registry-trust'
export type {
  AuthorizationAdapter,
  ClientAdapterRegistration,
  ClientRegistration,
  ClientRegistrySnapshot,
  ConsentMode,
  GeneratedRegistryArtifact,
  RegistryActivationRecord,
  RegistryActiveEnvelope,
  RegistryEnvironment,
  RegistryPublicKey,
  RegistrySnapshotRecord,
  RegistryTrustAnchors,
} from './registry-types'
export { createWebSsoCodeMachine } from './web-sso-code'
export type {
  ConsumeWebSsoCodeInput,
  IssueWebSsoCodeInput,
  WebSsoCodeRecord,
} from './web-sso-code'
