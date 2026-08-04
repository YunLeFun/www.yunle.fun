import type {
  ClientAdapterRegistration,
  ClientRegistration,
  ClientRegistrySnapshot,
} from './registry-types'

import { createHash } from 'node:crypto'

type JsonPrimitive = boolean | null | number | string
type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = [...left].map(character => character.codePointAt(0) ?? 0)
  const rightPoints = [...right].map(character => character.codePointAt(0) ?? 0)
  const length = Math.min(leftPoints.length, rightPoints.length)
  for (let index = 0; index < length; index++) {
    const leftPoint = leftPoints[index] ?? -1
    const rightPoint = rightPoints[index] ?? -1
    if (leftPoint !== rightPoint)
      return leftPoint - rightPoint
  }
  return leftPoints.length - rightPoints.length
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareUnicodeCodePoints)
}

function canonicalAdapter(adapter: ClientAdapterRegistration): ClientAdapterRegistration {
  return {
    kind: adapter.kind,
    consent: adapter.consent,
    allowedScopes: sortedUnique(adapter.allowedScopes),
    ...(adapter.origins ? { origins: sortedUnique(adapter.origins) } : {}),
    ...(adapter.redirectUris ? { redirectUris: sortedUnique(adapter.redirectUris) } : {}),
  }
}

function canonicalClient(client: ClientRegistration): ClientRegistration {
  return {
    clientId: client.clientId,
    appId: client.appId,
    displayName: client.displayName,
    ...(client.iconUrl ? { iconUrl: client.iconUrl } : {}),
    status: client.status,
    adapters: client.adapters
      .map(canonicalAdapter)
      .sort((left, right) => compareUnicodeCodePoints(left.kind, right.kind)),
  }
}

export function canonicalizeRegistry(registry: ClientRegistrySnapshot): ClientRegistrySnapshot {
  return {
    schemaVersion: 1,
    policyVersion: registry.policyVersion,
    issuer: registry.issuer,
    clients: registry.clients
      .map(canonicalClient)
      .sort((left, right) => compareUnicodeCodePoints(left.clientId, right.clientId)),
  }
}

function normalizeJson(value: unknown): JsonValue {
  if (Array.isArray(value))
    return value.map(item => normalizeJson(item))
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(record)
        .sort(compareUnicodeCodePoints)
        .map(key => [key, normalizeJson(record[key])]),
    )
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return value
  if (typeof value === 'number' && Number.isFinite(value))
    return value
  throw new TypeError('canonical JSON accepts only finite JSON values')
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeJson(value))
}

export function canonicalRegistryJson(registry: ClientRegistrySnapshot): string {
  return canonicalJson(canonicalizeRegistry(registry) as unknown as JsonValue)
}

export function registrySecurityProjection(registry: ClientRegistrySnapshot): JsonValue {
  const canonical = canonicalizeRegistry(registry)
  return {
    issuer: canonical.issuer,
    clients: canonical.clients.map(client => ({
      clientId: client.clientId,
      appId: client.appId,
      status: client.status,
      adapters: client.adapters.map(adapter => ({
        kind: adapter.kind,
        consent: adapter.consent,
        allowedScopes: adapter.allowedScopes,
        ...(adapter.origins ? { origins: adapter.origins } : {}),
        ...(adapter.redirectUris ? { redirectUris: adapter.redirectUris } : {}),
      })),
    })),
  }
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function hashRegistry(registry: ClientRegistrySnapshot): {
  canonicalJson: string
  contentHash: string
  securityHash: string
} {
  const serialized = canonicalRegistryJson(registry)
  return {
    canonicalJson: serialized,
    contentHash: sha256(serialized),
    securityHash: sha256(canonicalJson(registrySecurityProjection(registry))),
  }
}
