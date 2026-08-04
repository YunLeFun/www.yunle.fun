import type {
  AuthorizationAdapter,
  ClientAdapterRegistration,
  ClientRegistration,
  ClientRegistrySnapshot,
  ConsentMode,
  GeneratedRegistryArtifact,
  RegistryActivationRecord,
  RegistryActiveEnvelope,
  RegistryEnvironment,
  RegistrySnapshotRecord,
} from './registry-types'
import { canonicalizeRegistry, hashRegistry } from './registry-canonical'

const CLIENT_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/
const POLICY_VERSION_RE = /^[0-9a-z](?:[\w.-]{0,126}[0-9a-z])?$/i
const SCOPE_RE = /^[a-z][a-z0-9-]{0,63}:[a-z][a-z0-9-]{0,63}$/
const SIGNATURE_RE = /^[\w-]{80,128}$/
const ID_RE = /^[A-Z0-9][\w.:-]{0,191}$/i

const ALLOWED_SCOPES = new Set([
  'identity:bootstrap',
  'membership:read',
])

const ISSUERS: Record<RegistryEnvironment, string> = {
  production: 'https://www.yunle.fun',
  development: 'https://www.yunle.localhost:3000',
}

export class RegistryValidationError extends Error {
  readonly code: string
  readonly path: string

  constructor(code: string, path = '$') {
    super(`${code} at ${path}`)
    this.name = 'RegistryValidationError'
    this.code = code
    this.path = path
  }
}

function fail(code: string, path: string): never {
  throw new RegistryValidationError(code, path)
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('registry_invalid', path)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[], path: string): void {
  const allowed = new Set([...required, ...optional])
  for (const key of Object.keys(value)) {
    if (!allowed.has(key))
      fail('registry_unknown_field', `${path}.${key}`)
  }
  for (const key of required) {
    if (!(key in value))
      fail('registry_missing_field', `${path}.${key}`)
  }
}

function string(value: unknown, path: string, maximum = 512): string {
  if (typeof value !== 'string' || !value || value.length > maximum || value.trim() !== value)
    fail('registry_invalid_string', path)
  return value
}

function integer(value: unknown, path: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum)
    fail('registry_invalid_number', path)
  return value as number
}

function nullableString(value: unknown, path: string): string | null {
  return value === null ? null : string(value, path, 192)
}

function enumValue<T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (typeof value !== 'string' || !values.includes(value as T))
    fail('registry_invalid_enum', path)
  return value as T
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 64)
    fail('registry_invalid_array', path)
  return value.map((item, index) => string(item, `${path}[${index}]`, 2048))
}

function exactUrl(value: unknown, path: string, options: {
  environment: RegistryEnvironment
  originOnly?: boolean
}): string {
  const input = string(value, path, 2048)
  if (input.includes('*'))
    fail('registry_url_wildcard', path)
  let url: URL
  try {
    url = new URL(input)
  }
  catch {
    fail('registry_url_invalid', path)
  }
  if (!['http:', 'https:'].includes(url.protocol)
    || (options.environment === 'production' && url.protocol !== 'https:')
    || url.username
    || url.password
    || url.hash) {
    fail('registry_url_invalid', path)
  }
  if (options.originOnly) {
    if (input !== url.origin)
      fail('registry_origin_invalid', path)
  }
  else if (input !== url.toString()) {
    fail('registry_url_not_canonical', path)
  }
  return input
}

function parseAdapter(value: unknown, environment: RegistryEnvironment, path: string): ClientAdapterRegistration {
  const input = object(value, path)
  exactKeys(input, ['kind', 'consent', 'allowedScopes'], ['origins', 'redirectUris'], path)
  const kind = enumValue<AuthorizationAdapter>(input.kind, ['device', 'oidc', 'web-sso'], `${path}.kind`)
  const consent = enumValue<ConsentMode>(input.consent, ['explicit', 'trusted'], `${path}.consent`)
  const allowedScopes = stringArray(input.allowedScopes, `${path}.allowedScopes`).map((scope, index) => {
    if (!SCOPE_RE.test(scope) || !ALLOWED_SCOPES.has(scope))
      fail('registry_scope_invalid', `${path}.allowedScopes[${index}]`)
    return scope
  })
  const origins = input.origins === undefined
    ? undefined
    : stringArray(input.origins, `${path}.origins`).map((origin, index) => exactUrl(origin, `${path}.origins[${index}]`, { environment, originOnly: true }))
  const redirectUris = input.redirectUris === undefined
    ? undefined
    : stringArray(input.redirectUris, `${path}.redirectUris`).map((uri, index) => exactUrl(uri, `${path}.redirectUris[${index}]`, { environment }))

  if (kind === 'web-sso' && (!origins?.length || !redirectUris?.length))
    fail('registry_web_registration_incomplete', path)
  if (kind === 'device' && (origins || redirectUris))
    fail('registry_device_registration_invalid', path)

  return {
    kind,
    consent,
    allowedScopes,
    ...(origins ? { origins } : {}),
    ...(redirectUris ? { redirectUris } : {}),
  }
}

function parseClient(value: unknown, environment: RegistryEnvironment, path: string): ClientRegistration {
  const input = object(value, path)
  exactKeys(input, ['clientId', 'appId', 'displayName', 'status', 'adapters'], ['iconUrl'], path)
  const clientId = string(input.clientId, `${path}.clientId`, 128)
  const appId = string(input.appId, `${path}.appId`, 128)
  if (!CLIENT_ID_RE.test(clientId))
    fail('registry_client_id_invalid', `${path}.clientId`)
  if (!CLIENT_ID_RE.test(appId))
    fail('registry_app_id_invalid', `${path}.appId`)
  const displayName = string(input.displayName, `${path}.displayName`, 128)
  const status = enumValue(input.status, ['active', 'disabled'] as const, `${path}.status`)
  if (!Array.isArray(input.adapters) || input.adapters.length === 0 || input.adapters.length > 3)
    fail('registry_invalid_array', `${path}.adapters`)
  const adapters = input.adapters.map((adapter, index) => parseAdapter(adapter, environment, `${path}.adapters[${index}]`))
  if (new Set(adapters.map(adapter => adapter.kind)).size !== adapters.length)
    fail('registry_adapter_duplicate', `${path}.adapters`)

  const webOrigins = adapters.flatMap(adapter => adapter.kind === 'web-sso' ? adapter.origins ?? [] : [])
  const iconUrl = input.iconUrl === undefined
    ? undefined
    : exactUrl(input.iconUrl, `${path}.iconUrl`, { environment })
  if (webOrigins.length > 0) {
    if (!iconUrl)
      fail('registry_icon_required', `${path}.iconUrl`)
    const icon = new URL(iconUrl)
    if (icon.protocol !== 'https:' || icon.search || !webOrigins.includes(icon.origin))
      fail('registry_icon_origin_mismatch', `${path}.iconUrl`)
  }

  return {
    clientId,
    appId,
    displayName,
    ...(iconUrl ? { iconUrl } : {}),
    status,
    adapters,
  }
}

function parseRegistryEnvironment(value: unknown, path = '$.environment'): RegistryEnvironment {
  return enumValue(value, ['development', 'production'] as const, path)
}

export function parseClientRegistrySnapshot(value: unknown, options: {
  environment: RegistryEnvironment
  path?: string
}): ClientRegistrySnapshot {
  const path = options.path ?? '$'
  const input = object(value, path)
  exactKeys(input, ['schemaVersion', 'policyVersion', 'issuer', 'clients'], [], path)
  if (input.schemaVersion !== 1)
    fail('registry_schema_version_invalid', `${path}.schemaVersion`)
  const policyVersion = string(input.policyVersion, `${path}.policyVersion`, 128)
  if (!POLICY_VERSION_RE.test(policyVersion))
    fail('registry_policy_version_invalid', `${path}.policyVersion`)
  const issuer = exactUrl(input.issuer, `${path}.issuer`, { environment: options.environment, originOnly: true })
  if (issuer !== ISSUERS[options.environment])
    fail('registry_issuer_mismatch', `${path}.issuer`)
  if (!Array.isArray(input.clients) || input.clients.length > 512)
    fail('registry_invalid_array', `${path}.clients`)
  const clients = input.clients.map((client, index) => parseClient(client, options.environment, `${path}.clients[${index}]`))
  if (new Set(clients.map(client => client.clientId)).size !== clients.length)
    fail('registry_client_duplicate', `${path}.clients`)
  return canonicalizeRegistry({ schemaVersion: 1, policyVersion, issuer, clients })
}

export function parseRegistrySnapshotRecord(value: unknown, options: {
  environment: RegistryEnvironment
  path?: string
}): RegistrySnapshotRecord {
  const environment = options.environment
  const path = options.path ?? '$'
  const input = object(value, path)
  exactKeys(input, [
    'environment',
    'snapshotId',
    'sequence',
    'schemaVersion',
    'policyVersion',
    'registry',
    'canonicalJson',
    'contentHash',
    'securityHash',
    'keyId',
    'signature',
    'sourceDraftId',
    'changeReason',
    'publishedBy',
    'publishedAt',
  ], [], path)
  if (parseRegistryEnvironment(input.environment, `${path}.environment`) !== environment)
    fail('registry_environment_mismatch', `${path}.environment`)
  const registry = parseClientRegistrySnapshot(input.registry, { environment, path: `${path}.registry` })
  const snapshotId = string(input.snapshotId, `${path}.snapshotId`, 192)
  const keyId = string(input.keyId, `${path}.keyId`, 128)
  if (!ID_RE.test(snapshotId) || !ID_RE.test(keyId))
    fail('registry_identifier_invalid', path)
  const hashes = hashRegistry(registry)
  if (input.schemaVersion !== 1 || input.policyVersion !== registry.policyVersion)
    fail('registry_snapshot_metadata_mismatch', path)
  if (input.canonicalJson !== hashes.canonicalJson
    || input.contentHash !== hashes.contentHash
    || input.securityHash !== hashes.securityHash) {
    fail('registry_hash_mismatch', path)
  }
  if (typeof input.signature !== 'string' || !SIGNATURE_RE.test(input.signature))
    fail('registry_signature_invalid', `${path}.signature`)
  return {
    environment,
    snapshotId,
    sequence: integer(input.sequence, `${path}.sequence`, 1),
    schemaVersion: 1,
    policyVersion: registry.policyVersion,
    registry,
    canonicalJson: hashes.canonicalJson,
    contentHash: hashes.contentHash,
    securityHash: hashes.securityHash,
    keyId,
    signature: input.signature,
    sourceDraftId: string(input.sourceDraftId, `${path}.sourceDraftId`, 192),
    changeReason: string(input.changeReason, `${path}.changeReason`, 512),
    publishedBy: string(input.publishedBy, `${path}.publishedBy`, 192),
    publishedAt: integer(input.publishedAt, `${path}.publishedAt`, 1),
  }
}

function parseRegistryActivationRecord(value: unknown, options: {
  environment: RegistryEnvironment
  path?: string
}): RegistryActivationRecord {
  const environment = options.environment
  const path = options.path ?? '$'
  const input = object(value, path)
  exactKeys(input, [
    'environment',
    'generation',
    'activeSnapshotId',
    'action',
    'previousSnapshotId',
    'activatedBy',
    'activatedAt',
    'activationKeyId',
    'activationSignature',
  ], [], path)
  if (parseRegistryEnvironment(input.environment, `${path}.environment`) !== environment)
    fail('registry_environment_mismatch', `${path}.environment`)
  const activeSnapshotId = string(input.activeSnapshotId, `${path}.activeSnapshotId`, 192)
  const activationKeyId = string(input.activationKeyId, `${path}.activationKeyId`, 128)
  if (!ID_RE.test(activeSnapshotId) || !ID_RE.test(activationKeyId))
    fail('registry_identifier_invalid', path)
  if (typeof input.activationSignature !== 'string' || !SIGNATURE_RE.test(input.activationSignature))
    fail('registry_signature_invalid', `${path}.activationSignature`)
  return {
    environment,
    generation: integer(input.generation, `${path}.generation`, 1),
    activeSnapshotId,
    action: enumValue(input.action, ['publish', 'rollback'] as const, `${path}.action`),
    previousSnapshotId: nullableString(input.previousSnapshotId, `${path}.previousSnapshotId`),
    activatedBy: string(input.activatedBy, `${path}.activatedBy`, 192),
    activatedAt: integer(input.activatedAt, `${path}.activatedAt`, 1),
    activationKeyId,
    activationSignature: input.activationSignature,
  }
}

export function parseRegistryActiveEnvelope(value: unknown, options: {
  environment: RegistryEnvironment
  minimumGeneration?: number
}): RegistryActiveEnvelope {
  const input = object(value, '$')
  exactKeys(input, ['formatVersion', 'state', 'snapshot'], [], '$')
  if (input.formatVersion !== 1)
    fail('registry_schema_version_invalid', '$.formatVersion')
  const state = parseRegistryActivationRecord(input.state, { environment: options.environment, path: '$.state' })
  const snapshot = parseRegistrySnapshotRecord(input.snapshot, { environment: options.environment, path: '$.snapshot' })
  if (state.activeSnapshotId !== snapshot.snapshotId)
    fail('registry_active_snapshot_mismatch', '$.state.activeSnapshotId')
  if (state.generation < (options.minimumGeneration ?? 0))
    fail('registry_activation_replayed', '$.state.generation')
  return { formatVersion: 1, state, snapshot }
}

export function parseGeneratedRegistryArtifact(value: unknown, environment: RegistryEnvironment): GeneratedRegistryArtifact {
  const input = object(value, '$')
  exactKeys(input, ['formatVersion', 'environment', 'minimumGeneration', 'registry', 'activeEnvelope'], [], '$')
  if (input.formatVersion !== 1 || parseRegistryEnvironment(input.environment) !== environment)
    fail('registry_environment_mismatch', '$.environment')
  const minimumGeneration = integer(input.minimumGeneration, '$.minimumGeneration')
  const registry = parseClientRegistrySnapshot(input.registry, { environment, path: '$.registry' })
  const activeEnvelope = input.activeEnvelope === null
    ? null
    : parseRegistryActiveEnvelope(input.activeEnvelope, { environment, minimumGeneration })
  if (activeEnvelope && hashRegistry(activeEnvelope.snapshot.registry).contentHash !== hashRegistry(registry).contentHash)
    fail('registry_generated_snapshot_mismatch', '$.activeEnvelope.snapshot.registry')
  return { formatVersion: 1, environment, minimumGeneration, registry, activeEnvelope }
}
