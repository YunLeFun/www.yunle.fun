export type AuthorizationAdapter = 'device' | 'oidc' | 'web-sso'
export type ConsentMode = 'explicit' | 'trusted'
export type RegistryEnvironment = 'development' | 'production'

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

export interface RegistrySnapshotRecord {
  environment: RegistryEnvironment
  snapshotId: string
  sequence: number
  schemaVersion: 1
  policyVersion: string
  registry: ClientRegistrySnapshot
  canonicalJson: string
  contentHash: string
  securityHash: string
  keyId: string
  signature: string
  sourceDraftId: string
  changeReason: string
  publishedBy: string
  publishedAt: number
}

export interface RegistryActivationRecord {
  environment: RegistryEnvironment
  generation: number
  activeSnapshotId: string
  action: 'publish' | 'rollback'
  previousSnapshotId: string | null
  activatedBy: string
  activatedAt: number
  activationKeyId: string
  activationSignature: string
}

export interface RegistryActiveEnvelope {
  formatVersion: 1
  state: RegistryActivationRecord
  snapshot: RegistrySnapshotRecord
}

export interface RegistryReleaseIntentManifest {
  environment: RegistryEnvironment
  approvalId: string | null
  snapshotId: string
  generation: number
  policyVersion: string
  contentHash: string
  securityHash: string
  baseCommitSha: string
  manifestKeyId: string
  manifestSignature: string
}

export interface GeneratedRegistryArtifact {
  formatVersion: 1
  environment: RegistryEnvironment
  minimumGeneration: number
  registry: ClientRegistrySnapshot
  activeEnvelope: RegistryActiveEnvelope | null
}

export type RegistryPublicKey = Record<string, string>
export type RegistryTrustAnchors = Readonly<Record<RegistryEnvironment, Readonly<Record<string, RegistryPublicKey>>>>
