import type {
  ClientRegistrySnapshot,
  RegistryActivationRecord,
  RegistrySnapshotRecord,
  RegistryTrustAnchors,
} from '../../packages/authorization-core/src/index'

import { generateKeyPairSync } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'
import {
  createRegistryShadowObserver,
  hashRegistry,
  parseClientRegistrySnapshot,
  signRegistryActivation,
  signRegistrySnapshot,
} from '../../packages/authorization-core/src/index'

function staticRegistry(displayName = 'Sample', origin = 'https://sample.yunle.fun'): ClientRegistrySnapshot {
  return parseClientRegistrySnapshot({
    schemaVersion: 1,
    policyVersion: '2026-08-03.1',
    issuer: 'https://www.yunle.fun',
    clients: [{
      clientId: 'sample-web',
      appId: 'sample',
      displayName,
      iconUrl: `${origin}/icon.svg`,
      status: 'active',
      adapters: [{
        kind: 'web-sso',
        consent: 'trusted',
        allowedScopes: ['identity:bootstrap'],
        origins: [origin],
        redirectUris: [`${origin}/`],
      }],
    }],
  }, { environment: 'production' })
}

function signed(registry: ClientRegistrySnapshot, generation = 1) {
  const keys = generateKeyPairSync('ed25519')
  const hashes = hashRegistry(registry)
  const unsignedSnapshot: Omit<RegistrySnapshotRecord, 'signature'> = {
    environment: 'production',
    snapshotId: `production:${generation}:sample`,
    sequence: 1,
    schemaVersion: 1,
    policyVersion: registry.policyVersion,
    registry,
    ...hashes,
    keyId: 'registry-test',
    sourceDraftId: 'draft-test',
    changeReason: 'test',
    publishedBy: 'test',
    publishedAt: 1_785_700_000_000,
  }
  const snapshot: RegistrySnapshotRecord = {
    ...unsignedSnapshot,
    signature: signRegistrySnapshot(unsignedSnapshot, keys.privateKey),
  }
  const unsignedState: Omit<RegistryActivationRecord, 'activationSignature'> = {
    environment: 'production',
    generation,
    activeSnapshotId: snapshot.snapshotId,
    action: 'publish',
    previousSnapshotId: null,
    activatedBy: 'test',
    activatedAt: 1_785_700_000_000,
    activationKeyId: snapshot.keyId,
  }
  const state: RegistryActivationRecord = {
    ...unsignedState,
    activationSignature: signRegistryActivation(unsignedState, keys.privateKey),
  }
  const anchors: RegistryTrustAnchors = {
    production: {
      [snapshot.keyId]: keys.publicKey.export({ format: 'jwk' }) as Record<string, string>,
    },
    development: {},
  }
  return { envelope: { formatVersion: 1 as const, state, snapshot }, anchors }
}

describe('registry shadow observer', () => {
  it.each([
    ['registry_shadow_match', staticRegistry()],
    ['registry_shadow_display_drift', staticRegistry('Renamed')],
    ['registry_shadow_security_drift', staticRegistry('Sample', 'https://other.yunle.fun')],
  ] as const)('classifies %s without changing the static policy', async (expected, platformRegistry) => {
    const source = staticRegistry()
    const { envelope, anchors } = signed(platformRegistry)
    const events: string[] = []
    const observer = createRegistryShadowObserver({
      environment: 'production',
      staticRegistry: source,
      trustAnchors: anchors,
      loadEnvelope: async () => envelope,
      report: event => events.push(event.event),
    })

    expect((await observer.observe()).event).toBe(expected)
    expect(events).toEqual([expected])
    expect(source.clients[0].displayName).toBe('Sample')
  })

  it('uses one in-flight refresh for concurrent requests and caches the result', async () => {
    const source = staticRegistry()
    const { envelope, anchors } = signed(source)
    let resolveEnvelope: (value: unknown) => void = () => {}
    const deferred = new Promise<unknown>((resolve) => {
      resolveEnvelope = resolve
    })
    const loadEnvelope = vi.fn(() => deferred)
    let now = 1_000
    const observer = createRegistryShadowObserver({
      environment: 'production',
      staticRegistry: source,
      trustAnchors: anchors,
      loadEnvelope,
      now: () => now,
      timeoutMs: 1_000,
    })

    const first = observer.observe()
    const second = observer.observe()
    expect(loadEnvelope).toHaveBeenCalledTimes(1)
    resolveEnvelope(envelope)
    expect((await first).event).toBe('registry_shadow_match')
    expect((await second).event).toBe('registry_shadow_match')

    now += 100
    expect((await observer.observe()).event).toBe('registry_shadow_match')
    expect(loadEnvelope).toHaveBeenCalledTimes(1)
  })

  it('fails open to the static observer state on timeout and load failure', async () => {
    const source = staticRegistry()
    const { anchors } = signed(source)
    const loadEnvelope = vi.fn(() => new Promise<unknown>(() => {}))
    const now = 1_000
    const timeoutObserver = createRegistryShadowObserver({
      environment: 'production',
      staticRegistry: source,
      trustAnchors: anchors,
      loadEnvelope,
      now: () => now,
      failureTtlMs: 30_000,
      timeoutMs: 5,
    })
    expect(await timeoutObserver.observe()).toMatchObject({
      event: 'registry_shadow_unavailable',
      code: 'registry_shadow_timeout',
    })
    expect(timeoutObserver.getStatus()).toMatchObject({
      nextRefreshAt: now + 30_000,
      refreshing: false,
    })
    expect(await timeoutObserver.observe()).toMatchObject({
      event: 'registry_shadow_unavailable',
      code: 'registry_shadow_timeout',
    })
    expect(loadEnvelope).toHaveBeenCalledTimes(1)

    const failedObserver = createRegistryShadowObserver({
      environment: 'production',
      staticRegistry: source,
      trustAnchors: anchors,
      loadEnvelope: async () => { throw new Error('database unavailable') },
    })
    expect(await failedObserver.observe()).toMatchObject({
      event: 'registry_shadow_unavailable',
      code: 'registry_load_failed',
    })
  })

  it('reports invalid signatures and activation replay without throwing', async () => {
    const source = staticRegistry()
    const { envelope, anchors } = signed(source, 1)
    const invalidSignature = createRegistryShadowObserver({
      environment: 'production',
      staticRegistry: source,
      trustAnchors: anchors,
      loadEnvelope: async () => ({
        ...envelope,
        state: { ...envelope.state, activatedBy: 'tampered' },
      }),
    })
    expect((await invalidSignature.observe()).event).toBe('registry_shadow_signature_invalid')

    const replay = createRegistryShadowObserver({
      environment: 'production',
      staticRegistry: source,
      minimumGeneration: 2,
      trustAnchors: anchors,
      loadEnvelope: async () => envelope,
    })
    expect((await replay.observe()).event).toBe('registry_shadow_activation_replayed')
  })
})
