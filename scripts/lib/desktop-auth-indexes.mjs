/** Reconcile only the obsolete plaintext code index; preserve unrelated indexes. */
export const HASH_INDEX = { name: 'uniq_userCodeHash', key: { userCodeHash: 1 }, unique: true, sparse: true }
export const LEGACY_INDEX = { name: 'uniq_userCode', key: { userCode: 1 }, unique: true, sparse: false }

export function normalizeIndex(index) {
  return {
    name: index.name,
    key: index.key,
    unique: index.name === '_id_' || Boolean(index.unique),
    sparse: Boolean(index.sparse),
    ...(index.partialFilterExpression ? { partialFilterExpression: index.partialFilterExpression } : {}),
    ...(index.expireAfterSeconds !== undefined ? { expireAfterSeconds: index.expireAfterSeconds } : {}),
    ...(index.collation ? { collation: index.collation } : {}),
  }
}

function sameIndex(actual, expected) {
  return JSON.stringify(normalizeIndex(actual)) === JSON.stringify(normalizeIndex(expected))
}

export function planDesktopAuthIndexes(state) {
  if (!['ADMINONLY', 'PRIVATE'].includes(state.acl))
    throw new Error('desktop_device_codes must retain a non-public ACL')
  const { invalidHashes, duplicateHashes } = state.audit
  if (!Number.isSafeInteger(invalidHashes) || !Number.isSafeInteger(duplicateHashes)
    || invalidHashes !== 0 || duplicateHashes !== 0) {
    throw new Error('Invalid or duplicate userCodeHash values; stop for data review')
  }
  const indexes = new Map(state.indexes.map(index => [index.name, index]))
  if (!indexes.has('_id_'))
    throw new Error('Missing primary index')
  for (const expected of [HASH_INDEX, LEGACY_INDEX]) {
    if (indexes.has(expected.name) && !sameIndex(indexes.get(expected.name), expected))
      throw new Error(`Unexpected definition for ${expected.name}`)
  }
  // A second differently named unique plaintext index would leave the outage in place.
  for (const index of state.indexes) {
    if (index.unique && Object.hasOwn(index.key, 'userCode') && index.name !== LEGACY_INDEX.name)
      throw new Error('Unexpected plaintext code constraint')
  }
  return [
    ...(!indexes.has(HASH_INDEX.name) ? [{ action: 'create', index: HASH_INDEX }] : []),
    ...(indexes.has(LEGACY_INDEX.name) ? [{ action: 'drop', index: LEGACY_INDEX }] : []),
  ]
}

function retainedIndexes(state) {
  return state.indexes.filter(index => ![HASH_INDEX.name, LEGACY_INDEX.name].includes(index.name))
    .map(normalizeIndex)
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function reconcileDesktopAuthIndexes(adapter, { apply = false } = {}) {
  const before = await adapter.readState()
  const plan = planDesktopAuthIndexes(before)
  if (!apply)
    return { ready: plan.length === 0, plan, audit: before.audit, acl: before.acl }
  for (const step of plan) {
    // Re-read every precondition before each separate mutation.
    const current = await adapter.readState()
    const remaining = planDesktopAuthIndexes(current)
    if (current.acl !== before.acl)
      throw new Error('Collection permissions changed during migration')
    if (JSON.stringify(retainedIndexes(current)) !== JSON.stringify(retainedIndexes(before)))
      throw new Error('Unrelated indexes changed during migration')
    if (!remaining.some(item => item.action === step.action))
      continue
    if (step.action === 'create') {
      await adapter.createIndex(HASH_INDEX)
    }
    else {
      const hashIndex = current.indexes.find(index => index.name === HASH_INDEX.name)
      if (!hashIndex || !sameIndex(hashIndex, HASH_INDEX))
        throw new Error('Hash index must be verified before removing plaintext index')
      await adapter.dropIndex(LEGACY_INDEX.name)
    }
  }
  const after = await adapter.readState()
  if (after.acl !== before.acl || planDesktopAuthIndexes(after).length
    || JSON.stringify(retainedIndexes(after)) !== JSON.stringify(retainedIndexes(before))) {
    throw new Error('Index migration verification failed')
  }
  return { ready: true, applied: plan, audit: after.audit, acl: after.acl }
}
