import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { AI_RUNTIME_COLLECTION_MANIFESTS } = require('../../cloudfunctions/account-api/ai-point-resources.js')

function sameFields(left, right) {
  return JSON.stringify(left || []) === JSON.stringify(right || [])
}

function normalizedRemoteCollections(value) {
  if (!Array.isArray(value))
    throw new TypeError('remoteCollections must be an array')
  return value.map((item) => {
    if (!item || typeof item !== 'object' || typeof item.collection !== 'string')
      throw new TypeError('remote collection snapshot is invalid')
    return {
      collection: item.collection,
      access: typeof item.access === 'string' ? item.access : '',
      indexes: Array.isArray(item.indexes) ? item.indexes : [],
    }
  })
}

export function buildAiRuntimeResourcePlan({
  manifests = AI_RUNTIME_COLLECTION_MANIFESTS,
  remoteCollections = [],
} = {}) {
  const remote = normalizedRemoteCollections(remoteCollections)
  const expectedNames = new Set(manifests.map(item => item.collection))
  const remoteByName = new Map(remote.map(item => [item.collection, item]))
  const actions = []
  const unsafe = []

  for (const item of remote) {
    if (item.collection.startsWith('ai_') && !expectedNames.has(item.collection)) {
      unsafe.push({
        kind: 'unknown_managed_collection',
        collection: item.collection,
      })
    }
  }

  for (const manifest of manifests) {
    const existing = remoteByName.get(manifest.collection)
    if (!existing)
      actions.push({ kind: 'create_collection', collection: manifest.collection })
    if (existing?.access !== manifest.access) {
      actions.push({
        kind: 'set_access',
        collection: manifest.collection,
        access: manifest.access,
      })
    }

    const indexes = new Map((existing?.indexes || []).map(index => [index.name, index]))
    for (const index of manifest.indexes) {
      const current = indexes.get(index.name)
      if (!current) {
        actions.push({
          kind: 'create_index',
          collection: manifest.collection,
          index,
        })
      }
      else if (current.unique !== index.unique || !sameFields(current.fields, index.fields)) {
        unsafe.push({
          kind: 'index_definition_mismatch',
          collection: manifest.collection,
          index: index.name,
          expected: index,
          actual: current,
        })
      }
    }
  }

  const risks = actions.map((action) => {
    if (action.kind === 'create_collection') {
      return {
        kind: 'new_server_only_collection',
        collection: action.collection,
        detail: 'Creates an empty collection; no application traffic is enabled by this action.',
      }
    }
    if (action.kind === 'set_access') {
      return {
        kind: 'access_will_be_restricted',
        collection: action.collection,
        detail: 'Browser access will be restricted to ADMINONLY.',
      }
    }
    return {
      kind: 'index_build',
      collection: action.collection,
      index: action.index.name,
      detail: 'Index creation can consume database capacity while it is building.',
    }
  })
  const rollback = actions.map((action) => {
    if (action.kind === 'create_collection') {
      return {
        kind: 'never_auto_delete_collection',
        collection: action.collection,
        detail: 'Do not delete automatically; verify the collection is empty and obtain destructive-action approval.',
      }
    }
    if (action.kind === 'set_access') {
      return {
        kind: 'restore_access_from_snapshot',
        collection: action.collection,
        detail: 'Restore only from the reviewed pre-apply snapshot.',
      }
    }
    return {
      kind: 'remove_index_after_confirmation',
      collection: action.collection,
      index: action.index.name,
      detail: 'Remove only after query rollback and a separate destructive-action confirmation.',
    }
  })

  return {
    safe: unsafe.length === 0,
    actions,
    risks,
    rollback,
    unsafe,
  }
}
