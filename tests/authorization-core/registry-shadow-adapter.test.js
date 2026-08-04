import { describe, expect, it, vi } from 'vitest'

import {
  createCloudBaseRegistryShadow,
  createEnvelopeLoader,
} from '../../packages/cloudbase-registry-shadow/index.js'

function database(documents) {
  const get = vi.fn(async (collection, id) => ({
    data: documents[collection]?.[id] ? [{ _id: id, ...documents[collection][id] }] : [],
  }))
  return {
    get,
    collection(collection) {
      return {
        doc(id) {
          return { get: () => get(collection, id) }
        },
      }
    },
  }
}

describe('cloudBase Registry shadow adapter', () => {
  it('reads only the active pointer and its immutable snapshot', async () => {
    const db = database({
      sso_registry_state: {
        production: { activeSnapshotId: 'snapshot-1', generation: 1 },
      },
      sso_registry_snapshots: {
        'snapshot-1': { snapshotId: 'snapshot-1', policyVersion: '2026-08-03.1' },
      },
    })

    await expect(createEnvelopeLoader(db, 'production')()).resolves.toEqual({
      formatVersion: 1,
      state: { activeSnapshotId: 'snapshot-1', generation: 1 },
      snapshot: { snapshotId: 'snapshot-1', policyVersion: '2026-08-03.1' },
    })
    expect(db.get.mock.calls).toEqual([
      ['sso_registry_state', 'production'],
      ['sso_registry_snapshots', 'snapshot-1'],
    ])
  })

  it('does not query CloudBase while the switch or trust anchor is absent', async () => {
    const db = database({})
    const disabled = createCloudBaseRegistryShadow({
      db,
      environment: 'production',
      enabled: false,
      logPrefix: 'test',
      logger: console,
    })
    expect(await disabled.observe()).toBeNull()

    const missingAnchor = createCloudBaseRegistryShadow({
      db,
      environment: 'production',
      enabled: true,
      logPrefix: 'test',
      logger: console,
    })
    expect(missingAnchor.disabledReason).toBe('trust_anchor_missing')
    expect(await missingAnchor.observe()).toBeNull()
    expect(db.get).not.toHaveBeenCalled()
  })
})
