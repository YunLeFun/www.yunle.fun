import { describe, expect, it, vi } from 'vitest'
import { checkDesktopAuthIndexes } from '../scripts/check-desktop-auth-indexes.mjs'
import { HASH_INDEX, LEGACY_INDEX, planDesktopAuthIndexes, reconcileDesktopAuthIndexes } from '../scripts/lib/desktop-auth-indexes.mjs'

function fixture() {
  const state = {
    acl: 'ADMINONLY',
    indexes: [{ name: '_id_', key: { _id: 1 }, unique: true }, LEGACY_INDEX, { name: 'unrelated', key: { expiresAt: 1 } }],
    audit: { total: 6, missingHashes: 5, invalidHashes: 0, duplicateHashes: 0 },
  }
  return {
    state,
    readState: vi.fn(async () => structuredClone(state)),
    createIndex: vi.fn(async index => state.indexes.push(index)),
    dropIndex: vi.fn(async (name) => { state.indexes = state.indexes.filter(index => index.name !== name) }),
  }
}

describe('desktop authorization index migration', () => {
  it('defaults to a read-only plan with historical records retained', async () => {
    const adapter = fixture()
    const result = await reconcileDesktopAuthIndexes(adapter)
    expect(result.ready).toBe(false)
    expect(result.plan.map(step => step.action)).toEqual(['create', 'drop'])
    expect(adapter.createIndex).not.toHaveBeenCalled()
    expect(adapter.dropIndex).not.toHaveBeenCalled()
  })

  it('creates and verifies the hash constraint before dropping the old one, then is idempotent', async () => {
    const adapter = fixture()
    adapter.dropIndex.mockImplementation(async (name) => {
      expect(adapter.state.indexes).toContainEqual(HASH_INDEX)
      adapter.state.indexes = adapter.state.indexes.filter(index => index.name !== name)
    })
    expect((await reconcileDesktopAuthIndexes(adapter, { apply: true })).ready).toBe(true)
    expect(adapter.state.audit.total).toBe(6)
    expect(adapter.state.indexes.find(index => index.name === 'unrelated')).toBeDefined()
    expect((await reconcileDesktopAuthIndexes(adapter, { apply: true })).applied).toEqual([])
    expect(adapter.createIndex).toHaveBeenCalledTimes(1)
    expect(adapter.dropIndex).toHaveBeenCalledTimes(1)
  })

  it.each(['duplicateHashes', 'invalidHashes'])('rejects %s without modifying indexes', async (counter) => {
    const adapter = fixture()
    adapter.state.audit[counter] = 1
    await expect(reconcileDesktopAuthIndexes(adapter, { apply: true })).rejects.toThrow('data review')
    expect(adapter.createIndex).not.toHaveBeenCalled()
  })

  it('keeps the old constraint if creation fails or the new index cannot be verified', async () => {
    const adapter = fixture()
    adapter.createIndex.mockResolvedValue(undefined)
    await expect(reconcileDesktopAuthIndexes(adapter, { apply: true })).rejects.toThrow('must be verified')
    expect(adapter.dropIndex).not.toHaveBeenCalled()
  })

  it('rejects unexpected index definitions and permission drift', () => {
    const { state } = fixture()
    expect(() => planDesktopAuthIndexes({ ...state, acl: 'READONLY' })).toThrow('non-public ACL')
    expect(() => planDesktopAuthIndexes({ ...state, indexes: [...state.indexes, { ...HASH_INDEX, unique: false }] }))
      .toThrow('Unexpected definition')
    expect(() => planDesktopAuthIndexes({ ...state, indexes: [...state.indexes, { ...LEGACY_INDEX, name: 'other_plaintext' }] }))
      .toThrow('Unexpected plaintext')
  })

  it('preserves an existing PRIVATE ACL and rejects concurrent permission changes', async () => {
    const adapter = fixture()
    adapter.state.acl = 'PRIVATE'
    expect((await reconcileDesktopAuthIndexes(adapter, { apply: true })).acl).toBe('PRIVATE')
    const changed = fixture()
    changed.createIndex.mockImplementation(async (index) => {
      changed.state.indexes.push(index)
      changed.state.acl = 'PRIVATE'
    })
    await expect(reconcileDesktopAuthIndexes(changed, { apply: true })).rejects.toThrow('permissions changed')
    expect(changed.dropIndex).not.toHaveBeenCalled()
  })

  it('requires an exact environment confirmation before any apply call', async () => {
    const run = vi.fn()
    await expect(checkDesktopAuthIndexes('production', { apply: true, run, confirmEnv: 'development' }))
      .rejects
      .toThrow('exact environment')
    expect(run).not.toHaveBeenCalled()
  })
})
