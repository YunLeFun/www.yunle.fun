export type AuthorizationAdapter = 'device' | 'oidc' | 'web-sso'
export type ConsentMode = 'explicit' | 'trusted'

export interface ClientAdapterRegistration {
  kind: AuthorizationAdapter
  consent: ConsentMode
  allowedScopes: readonly string[]
  origins?: readonly string[]
  redirectUris?: readonly string[]
}

export interface ClientRegistration {
  clientId: string
  appId: string
  displayName: string
  /**
   * Stable, absolute URL for the client-owned icon.
   * Web SSO registrations must provide an icon from their registered Origin.
   */
  iconUrl?: string
  status: 'active' | 'disabled'
  adapters: readonly ClientAdapterRegistration[]
}

export interface ClientRegistrySnapshot {
  schemaVersion: 1
  policyVersion: string
  issuer: string
  clients: readonly ClientRegistration[]
}
