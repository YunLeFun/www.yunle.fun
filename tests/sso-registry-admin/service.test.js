import { generateKeyPairSync } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { createRegistryAdminService, RegistryAdminError } from '../../cloudfunctions/sso-registry-admin/service.js'

function cloneMaps(source) {
  return Object.fromEntries(Object.entries(source).map(([name, values]) => [
    name,
    new Map([...values].map(([key, value]) => [key, structuredClone(value)])),
  ]))
}

function memoryStore() {
  let maps = {
    drafts: new Map(),
    snapshots: new Map(),
    state: new Map(),
    audits: new Map(),
  }

  function adapter(target = () => maps) {
    return {
      getDraft: async id => structuredClone(target().drafts.get(id) || null),
      putDraft: async (id, value) => target().drafts.set(id, structuredClone(value)),
      updateDraft: async (id, value) => target().drafts.set(id, {
        ...target().drafts.get(id),
        ...structuredClone(value),
      }),
      getSnapshot: async id => structuredClone(target().snapshots.get(id) || null),
      putSnapshot: async (id, value) => target().snapshots.set(id, structuredClone(value)),
      getState: async id => structuredClone(target().state.get(id) || null),
      putState: async (id, value) => target().state.set(id, structuredClone(value)),
      putAudit: async (id, value) => target().audits.set(id, structuredClone(value)),
      async transaction(operation) {
        const staged = cloneMaps(maps)
        const result = await operation(adapter(() => staged))
        maps = staged
        return result
      },
    }
  }

  return {
    store: adapter(),
    snapshot: () => cloneMaps(maps),
  }
}

function registry(policyVersion = '2026-08-03.1', displayName = 'Sample') {
  return {
    schemaVersion: 1,
    policyVersion,
    issuer: 'https://www.yunle.fun',
    clients: [{
      clientId: 'sample-web',
      appId: 'sample',
      displayName,
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
  }
}

function setup() {
  const keys = generateKeyPairSync('ed25519')
  const memory = memoryStore()
  let clock = 1_785_700_000_000
  let sequence = 0
  const keyId = 'prod-registry-test'
  const service = createRegistryAdminService({
    environment: 'production',
    keyId,
    signingKey: keys.privateKey,
    trustAnchors: {
      production: {
        [keyId]: keys.publicKey.export({ format: 'jwk' }),
      },
      development: {},
    },
    store: memory.store,
    now: () => ++clock,
    randomId: () => `id-${++sequence}`,
  })
  return { memory, service }
}

function request(input = {}) {
  return {
    operator: 'registry-maintainer',
    changeReason: 'test registry change',
    requestId: 'request-test',
    ...input,
  }
}

describe('sso-registry-admin service', () => {
  it('saves a draft without changing active state, then publishes atomically', async () => {
    const { memory, service } = setup()
    const saved = await service.saveDraft(request({ registry: registry() }))
    expect(saved.draft.status).toBe('draft')
    expect(memory.snapshot().state.size).toBe(0)

    const published = await service.publishDraft(request({ draftId: saved.draftId }))
    expect(published).toMatchObject({
      idempotent: false,
      envelope: {
        state: { generation: 1, action: 'publish' },
        snapshot: { policyVersion: '2026-08-03.1' },
      },
    })
    const data = memory.snapshot()
    expect(data.snapshots.size).toBe(1)
    expect(data.state.get('production').activeSnapshotId).toBe(published.snapshotId)
    expect(data.drafts.get(saved.draftId)).toMatchObject({
      status: 'published',
      publishedSnapshotId: published.snapshotId,
    })
    expect([...data.audits.values()].map(item => item.action)).toEqual([
      'draft_saved',
      'publish_succeeded',
    ])
  })

  it('makes publish retries idempotent', async () => {
    const { memory, service } = setup()
    const draft = await service.saveDraft(request({ registry: registry() }))
    const first = await service.publishDraft(request({ draftId: draft.draftId }))
    const retried = await service.publishDraft(request({ draftId: draft.draftId }))

    expect(retried.idempotent).toBe(true)
    expect(retried.snapshotId).toBe(first.snapshotId)
    expect(memory.snapshot().snapshots.size).toBe(1)
  })

  it('rejects invalid drafts and never creates an active pointer', async () => {
    const { memory, service } = setup()
    await expect(service.saveDraft(request({
      registry: { ...registry(), unsafeDefault: true },
    }))).rejects.toEqual(expect.objectContaining({
      code: 'registry_unknown_field',
    }))
    expect(memory.snapshot().drafts.size).toBe(0)
    expect(memory.snapshot().state.size).toBe(0)
  })

  it('rolls back by advancing generation without mutating snapshots', async () => {
    const { memory, service } = setup()
    const firstDraft = await service.saveDraft(request({ registry: registry() }))
    const first = await service.publishDraft(request({ draftId: firstDraft.draftId }))
    const secondDraft = await service.saveDraft(request({
      registry: registry('2026-08-03.2', 'Renamed'),
    }))
    const second = await service.publishDraft(request({ draftId: secondDraft.draftId }))
    const before = memory.snapshot().snapshots

    const rolledBack = await service.rollback(request({ targetSnapshotId: first.snapshotId }))
    expect(rolledBack).toMatchObject({
      idempotent: false,
      envelope: {
        state: {
          generation: 3,
          action: 'rollback',
          activeSnapshotId: first.snapshotId,
          previousSnapshotId: second.snapshotId,
        },
        snapshot: { snapshotId: first.snapshotId },
      },
    })
    expect(memory.snapshot().snapshots).toEqual(before)
  })

  it('requires operator, reason and management request id', async () => {
    const { service } = setup()
    await expect(service.getStatus({})).rejects.toBeInstanceOf(RegistryAdminError)
    await expect(service.saveDraft(request({ operator: '', registry: registry() })))
      .rejects
      .toEqual(expect.objectContaining({ code: 'operator_required' }))
  })
})
