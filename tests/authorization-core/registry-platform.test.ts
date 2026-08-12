import type {
  ClientRegistrySnapshot,
  RegistryActivationRecord,
  RegistrySnapshotRecord,
  RegistryTrustAnchors,
} from '../../packages/authorization-core/src/index'

import { generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'
import {
  canonicalRegistryJson,
  developmentRegistryArtifact,
  hashRegistry,
  parseClientRegistrySnapshot,
  parseGeneratedRegistryArtifact,
  productionRegistryArtifact,
  registryTrustAnchors,
  RegistryValidationError,
  signRegistryActivation,
  signRegistryReleaseIntent,
  signRegistrySnapshot,
  verifyRegistryActiveEnvelope,
  verifyRegistryReleaseIntent,
} from '../../packages/authorization-core/src/index'

function registry(overrides: Partial<ClientRegistrySnapshot> = {}): ClientRegistrySnapshot {
  return {
    schemaVersion: 1,
    policyVersion: '2026-08-03.1',
    issuer: 'https://www.yunle.fun',
    clients: [{
      clientId: 'sample-web',
      appId: 'sample',
      displayName: 'Sample',
      iconUrl: 'https://sample.yunle.fun/icon.svg',
      status: 'active',
      adapters: [{
        kind: 'web-sso',
        consent: 'trusted',
        allowedScopes: ['identity:bootstrap'],
        origins: ['https://sample.yunle.fun'],
        redirectUris: ['https://sample.yunle.fun/'],
      }],
    }],
    ...overrides,
  }
}

function signedEnvelope(input: { generation?: number } = {}) {
  const keys = generateKeyPairSync('ed25519')
  const parsed = parseClientRegistrySnapshot(registry(), { environment: 'production' })
  const hashes = hashRegistry(parsed)
  const snapshotUnsigned: Omit<RegistrySnapshotRecord, 'signature'> = {
    environment: 'production',
    snapshotId: 'production:1:sample',
    sequence: 1,
    schemaVersion: 1,
    policyVersion: parsed.policyVersion,
    registry: parsed,
    ...hashes,
    keyId: 'prod-registry-2026-08',
    sourceDraftId: 'draft-1',
    changeReason: 'initial test snapshot',
    publishedBy: 'test-operator',
    publishedAt: 1_785_700_000_000,
  }
  const snapshot: RegistrySnapshotRecord = {
    ...snapshotUnsigned,
    signature: signRegistrySnapshot(snapshotUnsigned, keys.privateKey),
  }
  const activationUnsigned: Omit<RegistryActivationRecord, 'activationSignature'> = {
    environment: 'production',
    generation: input.generation ?? 1,
    activeSnapshotId: snapshot.snapshotId,
    action: 'publish',
    previousSnapshotId: null,
    activatedBy: 'test-operator',
    activatedAt: 1_785_700_000_000,
    activationKeyId: snapshot.keyId,
  }
  const state: RegistryActivationRecord = {
    ...activationUnsigned,
    activationSignature: signRegistryActivation(activationUnsigned, keys.privateKey),
  }
  const publicJwk = keys.publicKey.export({ format: 'jwk' }) as Record<string, string>
  const trustAnchors: RegistryTrustAnchors = {
    production: { [snapshot.keyId]: publicJwk },
    development: {},
  }
  return { envelope: { formatVersion: 1 as const, state, snapshot }, trustAnchors }
}

describe('registry platform schema and canonicalization', () => {
  it('normalizes set-like values and produces byte-stable hashes', () => {
    const first = registry({
      clients: [
        registry().clients[0],
        {
          clientId: 'device-client',
          appId: 'device',
          displayName: 'Device',
          status: 'active',
          adapters: [{
            kind: 'device',
            consent: 'explicit',
            allowedScopes: ['membership:read'],
          }],
        },
      ],
    })
    const second = registry({
      clients: [...first.clients].reverse().map(client => ({
        ...client,
        adapters: [...client.adapters].reverse().map(adapter => ({
          ...adapter,
          allowedScopes: [...adapter.allowedScopes].reverse(),
          ...(adapter.origins ? { origins: [...adapter.origins].reverse() } : {}),
          ...(adapter.redirectUris ? { redirectUris: [...adapter.redirectUris].reverse() } : {}),
        })),
      })),
    })

    const firstParsed = parseClientRegistrySnapshot(first, { environment: 'production' })
    const secondParsed = parseClientRegistrySnapshot(second, { environment: 'production' })
    expect(canonicalRegistryJson(firstParsed)).toBe(canonicalRegistryJson(secondParsed))
    expect(hashRegistry(firstParsed)).toEqual(hashRegistry(secondParsed))
  })

  it('keeps display-only drift out of the security hash', () => {
    const original = hashRegistry(registry())
    const renamed = hashRegistry(registry({
      clients: [{ ...registry().clients[0], displayName: 'Renamed Sample' }],
    }))

    expect(renamed.contentHash).not.toBe(original.contentHash)
    expect(renamed.securityHash).toBe(original.securityHash)
  })

  it.each([
    ['unknown field', { ...registry(), unsafeDefault: true }],
    ['duplicate client', { ...registry(), clients: [registry().clients[0], registry().clients[0]] }],
    ['wildcard origin', {
      ...registry(),
      clients: [{
        ...registry().clients[0],
        adapters: [{
          ...registry().clients[0].adapters[0],
          origins: ['https://*.yunle.fun'],
        }],
      }],
    }],
    ['production HTTP callback', {
      ...registry(),
      clients: [{
        ...registry().clients[0],
        iconUrl: 'http://sample.yunle.fun/icon.svg',
        adapters: [{
          ...registry().clients[0].adapters[0],
          origins: ['http://sample.yunle.fun'],
          redirectUris: ['http://sample.yunle.fun/'],
        }],
      }],
    }],
    ['unknown scope', {
      ...registry(),
      clients: [{
        ...registry().clients[0],
        adapters: [{
          ...registry().clients[0].adapters[0],
          allowedScopes: ['admin:all'],
        }],
      }],
    }],
  ])('rejects %s', (_name, input) => {
    expect(() => parseClientRegistrySnapshot(input, { environment: 'production' }))
      .toThrowError(RegistryValidationError)
  })

  it.each([
    ['production', productionRegistryArtifact],
    ['development', developmentRegistryArtifact],
  ] as const)('strictly loads and vendors the checked-in %s artifact', (environment, artifact) => {
    const parsed = parseGeneratedRegistryArtifact(artifact, environment)
    expect(parsed).toEqual(artifact)

    if (parsed.activeEnvelope) {
      expect(verifyRegistryActiveEnvelope(parsed.activeEnvelope, {
        environment,
        minimumGeneration: parsed.minimumGeneration,
        trustAnchors: registryTrustAnchors,
      })).toEqual(parsed.activeEnvelope)
    }
    else {
      expect(parsed.minimumGeneration).toBe(0)
    }

    const fileName = `${environment}-registry.json`
    const source = resolve(process.cwd(), 'packages/authorization-core/src/generated', fileName)
    const vendored = resolve(process.cwd(), 'packages/authorization-core/dist/generated', fileName)
    expect(JSON.parse(readFileSync(vendored, 'utf8')))
      .toEqual(JSON.parse(readFileSync(source, 'utf8')))
  })
})

describe('registry snapshot signatures', () => {
  it('verifies a snapshot and activation against code-owned trust anchors', () => {
    const { envelope, trustAnchors } = signedEnvelope()
    expect(verifyRegistryActiveEnvelope(envelope, {
      environment: 'production',
      trustAnchors,
      minimumGeneration: 1,
    })).toEqual(envelope)
  })

  it('rejects snapshot substitution, pointer tampering and replay', () => {
    const { envelope, trustAnchors } = signedEnvelope()
    expect(() => verifyRegistryActiveEnvelope({
      ...envelope,
      snapshot: {
        ...envelope.snapshot,
        publishedBy: 'attacker',
      },
    }, {
      environment: 'production',
      trustAnchors,
    })).toThrowError(expect.objectContaining({ code: 'registry_signature_invalid' }))

    expect(() => verifyRegistryActiveEnvelope({
      ...envelope,
      state: {
        ...envelope.state,
        activatedBy: 'attacker',
      },
    }, {
      environment: 'production',
      trustAnchors,
    })).toThrowError(expect.objectContaining({ code: 'registry_signature_invalid' }))

    expect(() => verifyRegistryActiveEnvelope(envelope, {
      environment: 'production',
      trustAnchors,
      minimumGeneration: 2,
    })).toThrowError(expect.objectContaining({ code: 'registry_activation_replayed' }))
  })

  it('rejects database-supplied or unknown keys', () => {
    const { envelope } = signedEnvelope()
    expect(() => verifyRegistryActiveEnvelope(envelope, {
      environment: 'production',
      trustAnchors: { production: {}, development: {} },
    })).toThrowError(expect.objectContaining({ code: 'registry_signature_key_unknown' }))
  })
})

describe('registry release intent signatures', () => {
  it('binds an approved release to its snapshot and repository base', () => {
    const keys = generateKeyPairSync('ed25519')
    const keyId = 'release-intent-test'
    const unsigned = {
      environment: 'production' as const,
      approvalId: 'approval:test',
      snapshotId: 'production:3:snapshot',
      generation: 3,
      policyVersion: '2026-08-08.3',
      contentHash: 'a'.repeat(64),
      securityHash: 'b'.repeat(64),
      baseCommitSha: 'c'.repeat(40),
      manifestKeyId: keyId,
    }
    const intent = {
      ...unsigned,
      manifestSignature: signRegistryReleaseIntent(unsigned, keys.privateKey),
    }
    const trustAnchors = {
      production: { [keyId]: keys.publicKey.export({ format: 'jwk' }) as Record<string, string> },
      development: {},
    }

    expect(verifyRegistryReleaseIntent(intent, { environment: 'production', trustAnchors })).toEqual(intent)
    expect(() => verifyRegistryReleaseIntent({
      ...intent,
      baseCommitSha: 'd'.repeat(40),
    }, { environment: 'production', trustAnchors })).toThrow(expect.objectContaining({
      code: 'registry_release_intent_signature_invalid',
    }))
  })
})
