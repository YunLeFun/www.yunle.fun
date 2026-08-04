/** Pure control-plane workflow for draft, publish and rollback operations. */

'use strict'

const {
  hashRegistry,
  parseClientRegistrySnapshot,
  parseRegistrySnapshotRecord,
  RegistryValidationError,
  signRegistryActivation,
  signRegistrySnapshot,
  verifyRegistryActiveEnvelope,
  verifyRegistrySnapshotSignature,
} = require('@yunlefun/authorization-core')

class RegistryAdminError extends Error {
  constructor(code, message = code) {
    super(message)
    this.name = 'RegistryAdminError'
    this.code = code
  }
}

function text(value, code, maximum = 512) {
  if (typeof value !== 'string' || !value.trim() || value.trim() !== value || value.length > maximum)
    throw new RegistryAdminError(code)
  return value
}

function requestMetadata(input) {
  return {
    operator: text(input?.operator, 'operator_required', 192),
    changeReason: text(input?.changeReason, 'change_reason_required', 512),
    requestId: text(input?.requestId, 'request_id_required', 192),
  }
}

function draftId(value, randomId) {
  if (value === undefined)
    return `draft:${randomId()}`
  return text(value, 'draft_id_invalid', 192)
}

function auditId(now, randomId) {
  return `audit:${now}:${randomId()}`
}

function publicEnvelope(state, snapshot) {
  return {
    formatVersion: 1,
    state,
    snapshot,
  }
}

function createRegistryAdminService(options) {
  const {
    environment,
    keyId,
    signingKey,
    store,
    trustAnchors,
  } = options
  const now = options.now || Date.now
  const randomId = options.randomId
  if (!['production', 'development'].includes(environment))
    throw new TypeError('Registry environment is invalid')
  if (!keyId || !signingKey || !store || typeof randomId !== 'function')
    throw new TypeError('Registry admin service is not configured')

  function parseRegistry(value) {
    try {
      return parseClientRegistrySnapshot(value, { environment })
    }
    catch (error) {
      if (error instanceof RegistryValidationError)
        throw new RegistryAdminError(error.code)
      throw error
    }
  }

  async function activeEnvelope(source = store) {
    const state = await source.getState(environment)
    if (!state)
      return null
    const snapshot = await source.getSnapshot(state.activeSnapshotId)
    if (!snapshot)
      throw new RegistryAdminError('active_snapshot_missing')
    try {
      return verifyRegistryActiveEnvelope(publicEnvelope(state, snapshot), {
        environment,
        trustAnchors,
      })
    }
    catch (error) {
      throw new RegistryAdminError(error?.code || 'active_snapshot_invalid')
    }
  }

  async function recordRejected(input, error) {
    const meta = requestMetadata(input)
    const createdAt = now()
    await store.putAudit(auditId(createdAt, randomId), {
      environment,
      action: 'publish_rejected',
      operator: meta.operator,
      reason: meta.changeReason,
      draftId: typeof input?.draftId === 'string' ? input.draftId : null,
      requestId: meta.requestId,
      createdAt,
      details: {
        code: error instanceof RegistryAdminError ? error.code : 'publish_failed',
      },
    })
  }

  function createSignedActivation(input) {
    const unsignedState = {
      environment,
      generation: input.generation,
      activeSnapshotId: input.activeSnapshotId,
      action: input.action,
      previousSnapshotId: input.previousSnapshotId,
      activatedBy: input.activatedBy,
      activatedAt: input.activatedAt,
      activationKeyId: keyId,
    }
    return {
      ...unsignedState,
      activationSignature: signRegistryActivation(unsignedState, signingKey),
    }
  }

  return {
    async saveDraft(input) {
      const meta = requestMetadata(input)
      const registry = parseRegistry(input?.registry)
      const id = draftId(input?.draftId, randomId)
      const savedAt = now()
      return store.transaction(async (transaction) => {
        const existing = await transaction.getDraft(id)
        if (existing?.status === 'published')
          throw new RegistryAdminError('draft_already_published')
        const current = await activeEnvelope(transaction)
        const currentSnapshotId = current?.state.activeSnapshotId || null
        const baseSnapshotId = input?.baseSnapshotId === undefined
          ? currentSnapshotId
          : input.baseSnapshotId
        if (baseSnapshotId !== null && typeof baseSnapshotId !== 'string')
          throw new RegistryAdminError('base_snapshot_invalid')
        const draft = {
          environment,
          baseSnapshotId,
          status: 'draft',
          registry,
          validation: { valid: true, errors: [], checkedAt: savedAt },
          changeReason: meta.changeReason,
          createdBy: existing?.createdBy || meta.operator,
          createdAt: existing?.createdAt || savedAt,
          updatedBy: meta.operator,
          updatedAt: savedAt,
        }
        await transaction.putDraft(id, draft)
        await transaction.putAudit(auditId(savedAt, randomId), {
          environment,
          action: 'draft_saved',
          operator: meta.operator,
          reason: meta.changeReason,
          draftId: id,
          requestId: meta.requestId,
          createdAt: savedAt,
          details: { baseSnapshotId },
        })
        return { draftId: id, draft }
      })
    },

    async validateDraft(input) {
      requestMetadata(input)
      const id = draftId(input?.draftId, randomId)
      const draft = await store.getDraft(id)
      if (!draft)
        throw new RegistryAdminError('draft_not_found')
      const registry = parseRegistry(draft.registry)
      return {
        draftId: id,
        valid: true,
        registry,
        hashes: hashRegistry(registry),
      }
    },

    async publishDraft(input) {
      const meta = requestMetadata(input)
      const id = draftId(input?.draftId, randomId)
      try {
        return await store.transaction(async (transaction) => {
          const draft = await transaction.getDraft(id)
          if (!draft)
            throw new RegistryAdminError('draft_not_found')
          if (draft.status === 'published') {
            return {
              idempotent: true,
              snapshotId: draft.publishedSnapshotId,
              envelope: await activeEnvelope(transaction),
            }
          }
          if (draft.status !== 'draft')
            throw new RegistryAdminError('draft_unavailable')
          const registry = parseRegistry(draft.registry)
          const current = await activeEnvelope(transaction)
          const previousSnapshotId = current?.state.activeSnapshotId || null
          if (draft.baseSnapshotId !== previousSnapshotId)
            throw new RegistryAdminError('draft_base_conflict')

          const publishedAt = now()
          const generation = Number(current?.state.generation || 0) + 1
          const hashes = hashRegistry(registry)
          const snapshotId = `${environment}:${generation}:${hashes.contentHash.slice(0, 20)}`
          if (await transaction.getSnapshot(snapshotId))
            throw new RegistryAdminError('snapshot_conflict')
          const unsignedSnapshot = {
            environment,
            snapshotId,
            sequence: generation,
            schemaVersion: 1,
            policyVersion: registry.policyVersion,
            registry,
            ...hashes,
            keyId,
            sourceDraftId: id,
            changeReason: meta.changeReason,
            publishedBy: meta.operator,
            publishedAt,
          }
          const snapshot = {
            ...unsignedSnapshot,
            signature: signRegistrySnapshot(unsignedSnapshot, signingKey),
          }
          const nextState = createSignedActivation({
            generation,
            activeSnapshotId: snapshotId,
            action: 'publish',
            previousSnapshotId,
            activatedBy: meta.operator,
            activatedAt: publishedAt,
          })
          await transaction.putSnapshot(snapshotId, snapshot)
          await transaction.putState(environment, nextState)
          await transaction.updateDraft(id, {
            status: 'published',
            publishedSnapshotId: snapshotId,
            updatedBy: meta.operator,
            updatedAt: publishedAt,
          })
          await transaction.putAudit(auditId(publishedAt, randomId), {
            environment,
            action: 'publish_succeeded',
            operator: meta.operator,
            reason: meta.changeReason,
            draftId: id,
            snapshotId,
            previousSnapshotId,
            requestId: meta.requestId,
            createdAt: publishedAt,
            details: {
              contentHash: hashes.contentHash,
              securityHash: hashes.securityHash,
              generation,
            },
          })
          return { idempotent: false, snapshotId, envelope: publicEnvelope(nextState, snapshot) }
        })
      }
      catch (error) {
        try {
          await recordRejected(input, error)
        }
        catch (auditError) {
          console.error('[sso-registry-admin] publish rejection audit failed', auditError?.code || auditError?.message || 'unknown')
        }
        throw error
      }
    },

    async rollback(input) {
      const meta = requestMetadata(input)
      const targetSnapshotId = text(input?.targetSnapshotId, 'target_snapshot_required', 192)
      return store.transaction(async (transaction) => {
        const currentEnvelope = await activeEnvelope(transaction)
        if (!currentEnvelope)
          throw new RegistryAdminError('active_snapshot_missing')
        const currentState = currentEnvelope.state
        if (currentState.activeSnapshotId === targetSnapshotId) {
          return {
            idempotent: true,
            envelope: await activeEnvelope(transaction),
          }
        }
        const rawTarget = await transaction.getSnapshot(targetSnapshotId)
        if (!rawTarget)
          throw new RegistryAdminError('target_snapshot_not_found')
        let target
        try {
          target = parseRegistrySnapshotRecord(rawTarget, { environment })
        }
        catch (error) {
          throw new RegistryAdminError(error?.code || 'target_snapshot_invalid')
        }
        const targetKey = trustAnchors?.[environment]?.[target.keyId]
        if (!targetKey || !verifyRegistrySnapshotSignature(target, targetKey))
          throw new RegistryAdminError('target_snapshot_signature_invalid')
        const activatedAt = now()
        const nextState = createSignedActivation({
          generation: Number(currentState.generation) + 1,
          activeSnapshotId: targetSnapshotId,
          action: 'rollback',
          previousSnapshotId: currentState.activeSnapshotId,
          activatedBy: meta.operator,
          activatedAt,
        })
        await transaction.putState(environment, nextState)
        await transaction.putAudit(auditId(activatedAt, randomId), {
          environment,
          action: 'rollback',
          operator: meta.operator,
          reason: meta.changeReason,
          snapshotId: targetSnapshotId,
          previousSnapshotId: currentState.activeSnapshotId,
          requestId: meta.requestId,
          createdAt: activatedAt,
          details: { generation: nextState.generation },
        })
        return { idempotent: false, envelope: publicEnvelope(nextState, target) }
      })
    },

    async getActiveEnvelope(input) {
      requestMetadata(input)
      const envelope = await activeEnvelope()
      if (!envelope)
        throw new RegistryAdminError('active_snapshot_missing')
      return envelope
    },

    async getStatus(input) {
      requestMetadata(input)
      const envelope = await activeEnvelope()
      return envelope
        ? {
            environment,
            initialized: true,
            generation: envelope.state.generation,
            snapshotId: envelope.snapshot.snapshotId,
            policyVersion: envelope.snapshot.policyVersion,
            contentHash: envelope.snapshot.contentHash,
            securityHash: envelope.snapshot.securityHash,
            action: envelope.state.action,
            activatedAt: envelope.state.activatedAt,
          }
        : { environment, initialized: false }
    },
  }
}

module.exports = {
  RegistryAdminError,
  createRegistryAdminService,
}
