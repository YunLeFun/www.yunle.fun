/** Read-only CloudBase adapter for the Registry shadow observer. */

'use strict'

const {
  createRegistryShadowObserver,
  developmentRegistryArtifact,
  hasRegistryTrustAnchor,
  productionRegistryArtifact,
  registryTrustAnchors,
} = require('@yunlefun/authorization-core')

function row(result) {
  if (Array.isArray(result?.data))
    return result.data[0] || null
  return result?.data && typeof result.data === 'object' ? result.data : null
}

function withoutId(value) {
  if (!value || typeof value !== 'object')
    return value
  const { _id, ...document } = value
  return document
}

function createEnvelopeLoader(db, environment) {
  return async () => {
    const state = row(await db.collection('sso_registry_state').doc(environment).get())
    if (!state || typeof state.activeSnapshotId !== 'string')
      throw new Error('Registry active state is unavailable')
    const snapshot = row(await db.collection('sso_registry_snapshots').doc(state.activeSnapshotId).get())
    if (!snapshot)
      throw new Error('Registry active snapshot is unavailable')
    return {
      formatVersion: 1,
      state: withoutId(state),
      snapshot: withoutId(snapshot),
    }
  }
}

function createCloudBaseRegistryShadow(options) {
  const artifact = options.environment === 'development'
    ? developmentRegistryArtifact
    : productionRegistryArtifact
  const enabled = options.enabled === true && hasRegistryTrustAnchor(options.environment)
  if (!enabled) {
    return {
      enabled: false,
      disabledReason: options.enabled === true ? 'trust_anchor_missing' : 'shadow_disabled',
      observe: async () => null,
      getStatus: () => null,
    }
  }

  const observer = createRegistryShadowObserver({
    environment: options.environment,
    staticRegistry: artifact.registry,
    minimumGeneration: artifact.minimumGeneration,
    trustAnchors: registryTrustAnchors,
    loadEnvelope: createEnvelopeLoader(options.db, options.environment),
    ttlMs: options.ttlMs,
    timeoutMs: options.timeoutMs,
    report(event) {
      const method = event.event === 'registry_shadow_match' ? 'info' : 'warn'
      options.logger?.[method]?.(
        `[${options.logPrefix}] registry_shadow`,
        JSON.stringify(event),
      )
    },
  })

  return {
    enabled: true,
    disabledReason: null,
    observe: () => observer.observe(),
    getStatus: () => observer.getStatus(),
  }
}

module.exports = {
  createCloudBaseRegistryShadow,
  createEnvelopeLoader,
}
