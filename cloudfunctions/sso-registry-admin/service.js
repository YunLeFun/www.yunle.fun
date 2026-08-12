/** Pure control-plane workflow for draft, publish and rollback operations. */

'use strict'

const { Buffer } = require('node:buffer')
const { createHmac, randomBytes, timingSafeEqual } = require('node:crypto')

const {
  hashRegistry,
  parseClientRegistrySnapshot,
  parseRegistrySnapshotRecord,
  RegistryValidationError,
  signRegistryActivation,
  signRegistryReleaseIntent,
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

const APPROVAL_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ'
const APPROVAL_TTL_MS = 30 * 60 * 1000

function defaultApprovalCode() {
  return [...randomBytes(12)].map(byte => APPROVAL_CODE_ALPHABET[byte & 31]).join('')
}

function isApprovalCode(value) {
  return typeof value === 'string'
    && value.length === 12
    && [...value].every(character => APPROVAL_CODE_ALPHABET.includes(character))
}

function hmacHex(secret, value) {
  return createHmac('sha256', secret).update(value).digest('hex')
}

function normalizedApprovalCode(value) {
  if (typeof value !== 'string')
    throw new RegistryAdminError('approval_code_required')
  const normalized = value.toUpperCase().replace(/[\s-]/g, '')
  if (!isApprovalCode(normalized))
    throw new RegistryAdminError('approval_code_invalid')
  return normalized
}

function secureHexEqual(first, second) {
  const left = Buffer.from(String(first), 'hex')
  const right = Buffer.from(String(second), 'hex')
  return left.length === right.length && timingSafeEqual(left, right)
}

function signedReleaseIntent(intent, signingKey) {
  return {
    ...intent,
    manifestSignature: signRegistryReleaseIntent(intent, signingKey),
  }
}

function commitSha(value) {
  const sha = text(value, 'base_commit_sha_required', 64)
  if (!/^[a-f0-9]{40}$/.test(sha))
    throw new RegistryAdminError('base_commit_sha_invalid')
  return sha
}

function optionalText(value, code, maximum = 512) {
  return value === undefined || value === null ? null : text(value, code, maximum)
}

function deploymentConsumers(value, options = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new RegistryAdminError('deployed_consumers_invalid')
  const allowed = new Set(['desktop-auth', 'sso-registry-admin', 'sso-ticket'])
  const entries = Object.entries(value)
  if (entries.some(([name, sha]) => !allowed.has(name) || typeof sha !== 'string' || !/^[a-f0-9]{40}$/.test(sha)))
    throw new RegistryAdminError('deployed_consumers_invalid')
  if (Array.isArray(options.required)) {
    const names = new Set(entries.map(([name]) => name))
    if (names.size !== options.required.length || options.required.some(name => !names.has(name)))
      throw new RegistryAdminError('deployed_consumers_incomplete')
  }
  if (options.commitSha && entries.some(([, sha]) => sha !== options.commitSha))
    throw new RegistryAdminError('deployed_consumer_commit_mismatch')
  return Object.fromEntries(entries)
}

function maskedEmail(value) {
  const [local, domain] = value.split('@')
  return `${local.slice(0, 1)}***@${domain}`
}

function registryDiff(previous, next) {
  const before = new Map((previous?.clients || []).map(client => [client.clientId, client]))
  const after = new Map(next.clients.map(client => [client.clientId, client]))
  const added = [...after.keys()].filter(clientId => !before.has(clientId)).sort()
  const removed = [...before.keys()].filter(clientId => !after.has(clientId)).sort()
  const common = [...after.keys()].filter(clientId => before.has(clientId))
  const securityProjection = client => ({
    appId: client.appId,
    status: client.status,
    adapters: client.adapters,
  })
  const displayProjection = client => ({ displayName: client.displayName, iconUrl: client.iconUrl || null })
  const securityChanged = common.filter(clientId => JSON.stringify(securityProjection(before.get(clientId)))
    !== JSON.stringify(securityProjection(after.get(clientId)))).sort()
  const displayChanged = common.filter(clientId => JSON.stringify(displayProjection(before.get(clientId)))
    !== JSON.stringify(displayProjection(after.get(clientId)))).sort()
  const modified = [...new Set([...securityChanged, ...displayChanged])].sort()
  return { added, displayChanged, modified, removed, securityChanged }
}

function sameRegistryValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function mergeRegistryValue(base, draft, current) {
  if (sameRegistryValue(draft, base))
    return current
  if (sameRegistryValue(current, base) || sameRegistryValue(current, draft))
    return draft
  throw new RegistryAdminError('draft_rebase_conflict')
}

function rebaseRegistry(base, draft, current) {
  const baseClients = new Map(base.clients.map(client => [client.clientId, client]))
  const draftClients = new Map(draft.clients.map(client => [client.clientId, client]))
  const currentClients = new Map(current.clients.map(client => [client.clientId, client]))
  const clientIds = new Set([...baseClients.keys(), ...draftClients.keys(), ...currentClients.keys()])
  const clients = [...clientIds]
    .sort()
    .map(clientId => mergeRegistryValue(
      baseClients.get(clientId),
      draftClients.get(clientId),
      currentClients.get(clientId),
    ))
    .filter(Boolean)
  return {
    schemaVersion: mergeRegistryValue(base.schemaVersion, draft.schemaVersion, current.schemaVersion),
    policyVersion: mergeRegistryValue(base.policyVersion, draft.policyVersion, current.policyVersion),
    issuer: mergeRegistryValue(base.issuer, draft.issuer, current.issuer),
    clients,
  }
}

function listLimit(value) {
  if (value === undefined)
    return 20
  if (!Number.isSafeInteger(value) || value < 1 || value > 50)
    throw new RegistryAdminError('list_limit_invalid')
  return value
}

function timestamp(value, code) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new RegistryAdminError(code)
  return parsed
}

function clientReviewSummary(client) {
  if (!client)
    return null
  return {
    clientId: client.clientId,
    appId: client.appId,
    displayName: client.displayName,
    status: client.status,
    adapters: client.adapters.map(adapter => ({
      kind: adapter.kind,
      consent: adapter.consent,
      allowedScopes: [...adapter.allowedScopes],
      origins: [...(adapter.origins || [])],
      redirectUris: [...(adapter.redirectUris || [])],
    })),
  }
}

function clientReviewChanges(previous, next, diff) {
  const before = new Map((previous?.clients || []).map(client => [client.clientId, client]))
  const after = new Map(next.clients.map(client => [client.clientId, client]))
  return diff.modified.concat(diff.added, diff.removed)
    .filter((clientId, index, values) => values.indexOf(clientId) === index)
    .sort()
    .map(clientId => ({
      clientId,
      categories: [
        ...(diff.added.includes(clientId) ? ['added'] : []),
        ...(diff.removed.includes(clientId) ? ['removed'] : []),
        ...(diff.securityChanged.includes(clientId) ? ['security'] : []),
        ...(diff.displayChanged.includes(clientId) ? ['display'] : []),
      ],
      before: clientReviewSummary(before.get(clientId)),
      after: clientReviewSummary(after.get(clientId)),
    }))
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
  const approvalPepper = options.approvalPepper
  const approverUids = Array.isArray(options.approverUids) ? options.approverUids : []
  const generateApprovalCode = options.generateApprovalCode || defaultApprovalCode
  const resolveApproverEmail = options.resolveApproverEmail
  const sendApprovalEmail = options.sendApprovalEmail
  const verifyAdminApprovalProof = options.verifyAdminApprovalProof
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

  async function publishDraftTransaction(transaction, { draft, id, meta, auditAction }) {
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
    if (auditAction) {
      await transaction.putAudit(auditId(publishedAt, randomId), {
        environment,
        action: auditAction,
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
    }
    return {
      envelope: publicEnvelope(nextState, snapshot),
      generation,
      hashes,
      publishedAt,
      snapshot,
      snapshotId,
    }
  }

  async function rollbackSnapshotTransaction(transaction, { draft, id, meta, targetSnapshotId }) {
    const current = await activeEnvelope(transaction)
    if (!current)
      throw new RegistryAdminError('active_snapshot_missing')
    if (draft.baseSnapshotId !== current.state.activeSnapshotId)
      throw new RegistryAdminError('draft_base_conflict')
    const target = await transaction.getSnapshot(targetSnapshotId)
    if (!target)
      throw new RegistryAdminError('target_snapshot_not_found')
    let verifiedTarget
    try {
      verifiedTarget = parseRegistrySnapshotRecord(target, { environment })
    }
    catch (error) {
      throw new RegistryAdminError(error?.code || 'target_snapshot_invalid')
    }
    const targetKey = trustAnchors?.[environment]?.[verifiedTarget.keyId]
    if (!targetKey || !verifyRegistrySnapshotSignature(verifiedTarget, targetKey))
      throw new RegistryAdminError('target_snapshot_signature_invalid')
    const activatedAt = now()
    const generation = Number(current.state.generation) + 1
    const nextState = createSignedActivation({
      generation,
      activeSnapshotId: targetSnapshotId,
      action: 'rollback',
      previousSnapshotId: current.state.activeSnapshotId,
      activatedBy: meta.operator,
      activatedAt,
    })
    await transaction.putState(environment, nextState)
    await transaction.updateDraft(id, {
      status: 'published',
      publishedSnapshotId: targetSnapshotId,
      updatedBy: meta.operator,
      updatedAt: activatedAt,
    })
    return {
      envelope: publicEnvelope(nextState, verifiedTarget),
      generation,
      hashes: {
        contentHash: verifiedTarget.contentHash,
        securityHash: verifiedTarget.securityHash,
      },
      publishedAt: activatedAt,
      snapshot: verifiedTarget,
      snapshotId: targetSnapshotId,
    }
  }

  async function queuePublishedRelease(transaction, {
    approvalId,
    baseCommitSha,
    draftId,
    meta,
    published,
  }) {
    const releaseIntentId = `release:${environment}:${published.generation}:${randomId()}`
    const intent = signedReleaseIntent({
      environment,
      approvalId,
      snapshotId: published.snapshotId,
      generation: published.generation,
      policyVersion: published.snapshot.policyVersion,
      contentHash: published.hashes.contentHash,
      securityHash: published.hashes.securityHash,
      baseCommitSha,
      status: 'approved',
      manifestKeyId: keyId,
      dispatchAttempts: 0,
      createdAt: published.publishedAt,
      updatedAt: published.publishedAt,
    }, signingKey)
    await transaction.putReleaseIntent(releaseIntentId, intent)
    await transaction.putOutbox(releaseIntentId, {
      environment,
      releaseIntentId,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: published.publishedAt,
      createdAt: published.publishedAt,
      updatedAt: published.publishedAt,
    })
    await transaction.updateDraft(draftId, { releaseIntentId })
    await transaction.putAudit(auditId(published.publishedAt, randomId), {
      environment,
      action: 'release_approved',
      operator: meta.operator,
      reason: meta.changeReason,
      draftId,
      approvalId,
      releaseIntentId,
      snapshotId: published.snapshotId,
      requestId: meta.requestId,
      createdAt: published.publishedAt,
      details: {
        baseCommitSha,
        generation: published.generation,
        contentHash: published.hashes.contentHash,
        securityHash: published.hashes.securityHash,
      },
    })
    return {
      idempotent: false,
      releaseIntentId,
      snapshotId: published.snapshotId,
      generation: published.generation,
      status: intent.status,
    }
  }

  const api = {
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
          ? existing?.baseSnapshotId ?? currentSnapshotId
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

    async rebaseDraft(input) {
      if (environment !== 'production')
        throw new RegistryAdminError('draft_rebase_production_only')
      const meta = requestMetadata(input)
      const id = draftId(input?.draftId, randomId)
      return store.transaction(async (transaction) => {
        const draft = await transaction.getDraft(id)
        if (!draft || draft.status !== 'draft')
          throw new RegistryAdminError('draft_unavailable')
        if (draft.rollbackTargetSnapshotId)
          throw new RegistryAdminError('draft_rebase_rollback_unsupported')
        const current = await activeEnvelope(transaction)
        if (!current)
          throw new RegistryAdminError('active_snapshot_missing')
        if (draft.baseSnapshotId === current.state.activeSnapshotId) {
          return {
            draftId: id,
            outcome: 'already_current',
            activeGeneration: current.state.generation,
            baseSnapshotId: current.state.activeSnapshotId,
            policyVersion: current.snapshot.policyVersion,
            diffSummary: registryDiff(current.snapshot.registry, parseRegistry(draft.registry)),
          }
        }
        if (!draft.baseSnapshotId)
          throw new RegistryAdminError('draft_rebase_base_missing')
        const sourceSnapshot = await transaction.getSnapshot(draft.baseSnapshotId)
        if (!sourceSnapshot)
          throw new RegistryAdminError('draft_rebase_base_missing')
        let baseSnapshot
        try {
          baseSnapshot = parseRegistrySnapshotRecord(sourceSnapshot, { environment })
        }
        catch (error) {
          throw new RegistryAdminError(error?.code || 'draft_rebase_base_invalid')
        }
        const baseKey = trustAnchors?.[environment]?.[baseSnapshot.keyId]
        if (!baseKey || !verifyRegistrySnapshotSignature(baseSnapshot, baseKey))
          throw new RegistryAdminError('draft_rebase_base_signature_invalid')

        const mergedRegistry = parseRegistry(rebaseRegistry(
          baseSnapshot.registry,
          parseRegistry(draft.registry),
          current.snapshot.registry,
        ))
        const hashes = hashRegistry(mergedRegistry)
        const rebasedAt = now()
        const alreadyApplied = hashes.contentHash === current.snapshot.contentHash
          && hashes.securityHash === current.snapshot.securityHash
        const pendingApproval = await transaction.findPendingApprovalByDraft(environment, id)
        if (pendingApproval) {
          await transaction.updateApproval(pendingApproval.approvalId, {
            status: 'canceled',
            updatedAt: rebasedAt,
          })
        }
        await transaction.updateDraft(id, alreadyApplied
          ? {
              status: 'superseded',
              supersededBySnapshotId: current.state.activeSnapshotId,
              updatedBy: meta.operator,
              updatedAt: rebasedAt,
            }
          : {
              baseSnapshotId: current.state.activeSnapshotId,
              registry: mergedRegistry,
              validation: { valid: true, errors: [], checkedAt: rebasedAt },
              updatedBy: meta.operator,
              updatedAt: rebasedAt,
            })
        await transaction.putAudit(auditId(rebasedAt, randomId), {
          environment,
          action: alreadyApplied ? 'draft_superseded' : 'draft_rebased',
          operator: meta.operator,
          reason: meta.changeReason,
          draftId: id,
          requestId: meta.requestId,
          createdAt: rebasedAt,
          details: {
            previousSnapshotId: draft.baseSnapshotId,
            baseSnapshotId: current.state.activeSnapshotId,
            contentHash: hashes.contentHash,
            securityHash: hashes.securityHash,
          },
        })
        return {
          draftId: id,
          outcome: alreadyApplied ? 'already_applied' : 'rebased',
          activeGeneration: current.state.generation,
          baseSnapshotId: current.state.activeSnapshotId,
          policyVersion: mergedRegistry.policyVersion,
          diffSummary: registryDiff(current.snapshot.registry, mergedRegistry),
        }
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

    async getDraftDiff(input) {
      requestMetadata(input)
      const id = draftId(input?.draftId, randomId)
      const draft = await store.getDraft(id)
      if (!draft)
        throw new RegistryAdminError('draft_unavailable')
      const registry = parseRegistry(draft.registry)
      const current = await activeEnvelope()
      const hashes = hashRegistry(registry)
      if (draft.status === 'published') {
        const existingIntent = draft.releaseIntentId
          ? await store.getReleaseIntent(draft.releaseIntentId)
          : null
        if (!existingIntent
          || existingIntent.status !== 'superseded'
          || !current
          || draft.publishedSnapshotId !== existingIntent.snapshotId
          || current.state.activeSnapshotId !== existingIntent.snapshotId
          || current.state.generation !== existingIntent.generation
          || current.snapshot.policyVersion !== registry.policyVersion
          || current.snapshot.contentHash !== hashes.contentHash
          || current.snapshot.securityHash !== hashes.securityHash) {
          throw new RegistryAdminError('draft_unavailable')
        }
      }
      else if (draft.status !== 'draft') {
        throw new RegistryAdminError('draft_unavailable')
      }
      const diff = registryDiff(current?.snapshot.registry, registry)
      return {
        draftId: id,
        baseSnapshotId: draft.status === 'published'
          ? current.state.activeSnapshotId
          : draft.baseSnapshotId,
        baseGeneration: current?.state.generation || 0,
        policyVersion: registry.policyVersion,
        clientCount: registry.clients.length,
        contentHash: hashes.contentHash,
        securityHash: hashes.securityHash,
        diffSummary: diff,
        changes: clientReviewChanges(current?.snapshot.registry, registry, diff),
        changeReason: text(draft.changeReason, 'draft_change_reason_invalid', 512),
        createdBy: text(draft.createdBy, 'draft_created_by_invalid', 192),
        createdAt: timestamp(draft.createdAt, 'draft_created_at_invalid'),
        updatedBy: text(draft.updatedBy, 'draft_updated_by_invalid', 192),
        updatedAt: timestamp(draft.updatedAt, 'draft_updated_at_invalid'),
      }
    },

    async listApprovalDrafts(input) {
      if (environment !== 'production')
        throw new RegistryAdminError('admin_approval_production_only')
      requestMetadata(input)
      const current = await activeEnvelope()
      const drafts = await store.listDrafts(environment, 'draft', listLimit(input?.limit))
      return {
        environment,
        activeGeneration: current?.state.generation || 0,
        activePolicyVersion: current?.snapshot.policyVersion || null,
        items: drafts.map((draft) => {
          const registry = parseRegistry(draft.registry)
          const hashes = hashRegistry(registry)
          const diff = registryDiff(current?.snapshot.registry, registry)
          return {
            draftId: draftId(draft.draftId, randomId),
            baseSnapshotId: draft.baseSnapshotId,
            policyVersion: registry.policyVersion,
            clientCount: registry.clients.length,
            contentHash: hashes.contentHash,
            securityHash: hashes.securityHash,
            diffSummary: diff,
            changes: clientReviewChanges(current?.snapshot.registry, registry, diff),
            changeReason: text(draft.changeReason, 'draft_change_reason_invalid', 512),
            createdBy: text(draft.createdBy, 'draft_created_by_invalid', 192),
            createdAt: timestamp(draft.createdAt, 'draft_created_at_invalid'),
            updatedBy: text(draft.updatedBy, 'draft_updated_by_invalid', 192),
            updatedAt: timestamp(draft.updatedAt, 'draft_updated_at_invalid'),
            staleBase: draft.baseSnapshotId !== (current?.state.activeSnapshotId || null),
          }
        }),
      }
    },

    async requestPublishApproval(input) {
      if (environment !== 'production')
        throw new RegistryAdminError('approval_not_required')
      if (typeof approvalPepper !== 'string' || Buffer.byteLength(approvalPepper, 'utf8') < 32)
        throw new RegistryAdminError('approval_pepper_unavailable')
      if (typeof resolveApproverEmail !== 'function' || typeof sendApprovalEmail !== 'function')
        throw new RegistryAdminError('approval_delivery_unavailable')
      const meta = requestMetadata(input)
      const id = draftId(input?.draftId, randomId)
      const baseCommitSha = commitSha(input?.baseCommitSha)
      const requestedUid = typeof input?.approverUid === 'string' ? input.approverUid : null
      const approverUid = requestedUid || (approverUids.length === 1 ? approverUids[0] : null)
      if (!approverUid || !approverUids.includes(approverUid))
        throw new RegistryAdminError('approver_not_allowed')
      const email = await resolveApproverEmail(approverUid)
      if (typeof email !== 'string' || !email.includes('@'))
        throw new RegistryAdminError('approver_email_unverified')

      const approvalId = `approval:${randomId()}`
      const code = generateApprovalCode()
      if (!isApprovalCode(code))
        throw new RegistryAdminError('approval_code_generation_failed')
      const createdAt = now()
      const expiresAt = createdAt + APPROVAL_TTL_MS
      const recipientMasked = maskedEmail(email)
      const approval = await store.transaction(async (transaction) => {
        const draft = await transaction.getDraft(id)
        if (!draft || draft.status !== 'draft')
          throw new RegistryAdminError('draft_unavailable')
        const registry = parseRegistry(draft.registry)
        const current = await activeEnvelope(transaction)
        const baseSnapshotId = current?.state.activeSnapshotId || null
        const baseGeneration = current?.state.generation || 0
        if (draft.baseSnapshotId !== baseSnapshotId)
          throw new RegistryAdminError('draft_base_conflict')
        const existing = await transaction.findPendingApprovalByDraft(environment, id)
        if (existing) {
          await transaction.updateApproval(existing.approvalId, {
            status: 'canceled',
            updatedAt: createdAt,
          })
        }
        const hashes = hashRegistry(registry)
        const document = {
          environment,
          draftId: id,
          baseSnapshotId,
          baseGeneration,
          baseCommitSha,
          policyVersion: registry.policyVersion,
          clientCount: registry.clients.length,
          contentHash: hashes.contentHash,
          securityHash: hashes.securityHash,
          diffSummary: registryDiff(current?.snapshot.registry, registry),
          targetSnapshotId: typeof draft.rollbackTargetSnapshotId === 'string'
            ? draft.rollbackTargetSnapshotId
            : null,
          requester: meta.operator,
          requestId: meta.requestId,
          changeReason: meta.changeReason,
          approverUid,
          recipientHash: hmacHex(approvalPepper, `recipient\0${email.toLowerCase()}`),
          recipientMasked,
          codeMac: hmacHex(approvalPepper, `${approvalId}\0${code}`),
          attempts: 0,
          maxAttempts: 5,
          status: 'delivery_pending',
          expiresAt,
          createdAt,
          updatedAt: createdAt,
        }
        await transaction.putApproval(approvalId, document)
        return document
      })

      let delivery
      try {
        delivery = await sendApprovalEmail({
          approvalId,
          to: email,
          code,
          environment,
          policyVersion: approval.policyVersion,
          clientCount: approval.clientCount,
          diffSummary: approval.diffSummary,
          contentHash: approval.contentHash,
          securityHash: approval.securityHash,
          requester: meta.operator,
          changeReason: meta.changeReason,
          expiresAt,
        })
      }
      catch {
        await store.transaction(async (transaction) => {
          await transaction.updateApproval(approvalId, {
            status: 'delivery_failed',
            updatedAt: now(),
          })
        })
        throw new RegistryAdminError('approval_delivery_failed')
      }
      await store.transaction(async (transaction) => {
        const currentApproval = await transaction.getApproval(approvalId)
        if (!currentApproval || currentApproval.status !== 'delivery_pending')
          throw new RegistryAdminError('approval_state_conflict')
        const updatedAt = now()
        await transaction.updateApproval(approvalId, {
          status: 'pending',
          deliveryMessageId: text(delivery?.id, 'approval_delivery_invalid', 256),
          deliveryRequestId: typeof delivery?.requestId === 'string' ? delivery.requestId : null,
          updatedAt,
        })
        await transaction.putAudit(auditId(updatedAt, randomId), {
          environment,
          action: 'approval_requested',
          operator: meta.operator,
          reason: meta.changeReason,
          draftId: id,
          approvalId,
          requestId: meta.requestId,
          createdAt: updatedAt,
          details: {
            approverUid,
            recipientHash: approval.recipientHash,
            expiresAt,
          },
        })
      })
      return { approvalId, status: 'pending', recipientMasked, expiresAt }
    },

    async approveAndQueueRelease(input) {
      if (environment === 'development') {
        const meta = requestMetadata(input)
        const id = draftId(input?.draftId, randomId)
        const baseCommitSha = commitSha(input?.baseCommitSha)
        return store.transaction(async (transaction) => {
          const draft = await transaction.getDraft(id)
          if (!draft)
            throw new RegistryAdminError('draft_not_found')
          if (draft.status === 'published' && draft.releaseIntentId) {
            const existingIntent = await transaction.getReleaseIntent(draft.releaseIntentId)
            if (!existingIntent)
              throw new RegistryAdminError('release_intent_missing')
            return {
              idempotent: true,
              releaseIntentId: draft.releaseIntentId,
              snapshotId: existingIntent.snapshotId,
              generation: existingIntent.generation,
              status: existingIntent.status,
            }
          }
          if (draft.status !== 'draft')
            throw new RegistryAdminError('draft_unavailable')
          const published = draft.rollbackTargetSnapshotId
            ? await rollbackSnapshotTransaction(transaction, {
                draft,
                id,
                meta,
                targetSnapshotId: draft.rollbackTargetSnapshotId,
              })
            : await publishDraftTransaction(transaction, {
                draft,
                id,
                meta,
                auditAction: null,
              })
          return queuePublishedRelease(transaction, {
            approvalId: null,
            baseCommitSha,
            draftId: id,
            meta,
            published,
          })
        })
      }
      if (typeof approvalPepper !== 'string' || Buffer.byteLength(approvalPepper, 'utf8') < 32)
        throw new RegistryAdminError('approval_pepper_unavailable')
      const meta = requestMetadata(input)
      const approvalId = text(input?.approvalId, 'approval_id_required', 192)
      const code = normalizedApprovalCode(input?.code)
      const result = await store.transaction(async (transaction) => {
        const approval = await transaction.getApproval(approvalId)
        if (!approval)
          return { error: 'approval_not_found' }
        if (approval.status === 'consumed' && approval.releaseIntentId) {
          const existingIntent = await transaction.getReleaseIntent(approval.releaseIntentId)
          if (!existingIntent)
            throw new RegistryAdminError('release_intent_missing')
          return {
            idempotent: true,
            releaseIntentId: approval.releaseIntentId,
            snapshotId: existingIntent.snapshotId,
            generation: existingIntent.generation,
            status: existingIntent.status,
          }
        }
        if (approval.status !== 'pending')
          return { error: `approval_${approval.status}` }
        const checkedAt = now()
        if (approval.expiresAt <= checkedAt) {
          await transaction.updateApproval(approvalId, { status: 'expired', updatedAt: checkedAt })
          return { error: 'approval_expired' }
        }
        const codeMac = hmacHex(approvalPepper, `${approvalId}\0${code}`)
        if (!secureHexEqual(codeMac, approval.codeMac)) {
          const attempts = Number(approval.attempts || 0) + 1
          const status = attempts >= Number(approval.maxAttempts || 5) ? 'locked' : 'pending'
          await transaction.updateApproval(approvalId, { attempts, status, updatedAt: checkedAt })
          return { error: status === 'locked' ? 'approval_locked' : 'approval_code_invalid' }
        }
        const draft = await transaction.getDraft(approval.draftId)
        if (!draft || draft.status !== 'draft')
          return { error: 'draft_unavailable' }
        const current = await activeEnvelope(transaction)
        const currentSnapshotId = current?.state.activeSnapshotId || null
        const currentGeneration = current?.state.generation || 0
        const hashes = hashRegistry(parseRegistry(draft.registry))
        if (draft.baseSnapshotId !== approval.baseSnapshotId
          || currentSnapshotId !== approval.baseSnapshotId
          || currentGeneration !== approval.baseGeneration
          || hashes.contentHash !== approval.contentHash
          || hashes.securityHash !== approval.securityHash) {
          await transaction.updateApproval(approvalId, { status: 'canceled', updatedAt: checkedAt })
          return { error: 'approval_stale' }
        }

        const published = approval.targetSnapshotId
          ? await rollbackSnapshotTransaction(transaction, {
              draft,
              id: approval.draftId,
              meta,
              targetSnapshotId: approval.targetSnapshotId,
            })
          : await publishDraftTransaction(transaction, {
              draft,
              id: approval.draftId,
              meta,
              auditAction: null,
            })
        const queued = await queuePublishedRelease(transaction, {
          approvalId,
          baseCommitSha: approval.baseCommitSha,
          draftId: approval.draftId,
          meta,
          published,
        })
        await transaction.updateApproval(approvalId, {
          status: 'consumed',
          consumedAt: checkedAt,
          releaseIntentId: queued.releaseIntentId,
          updatedAt: checkedAt,
        })
        return queued
      })
      if (result.error)
        throw new RegistryAdminError(result.error)
      return result
    },

    async approveAndQueueReleaseByAdmin(input) {
      if (environment !== 'production')
        throw new RegistryAdminError('admin_approval_production_only')
      if (typeof verifyAdminApprovalProof !== 'function')
        throw new RegistryAdminError('admin_approval_verifier_unavailable')
      const claims = verifyAdminApprovalProof(input?.approvalProof)
      if (!approverUids.includes(claims.sub))
        throw new RegistryAdminError('approver_not_allowed')

      const id = draftId(claims.draftId, randomId)
      const baseCommitSha = commitSha(claims.baseCommitSha)
      const meta = requestMetadata({
        operator: `admin:${claims.login} (${claims.sub})`,
        changeReason: claims.changeReason,
        requestId: input?.requestId,
      })
      return store.transaction(async (transaction) => {
        const draft = await transaction.getDraft(id)
        if (!draft)
          throw new RegistryAdminError('draft_not_found')
        if (draft.status === 'published' && draft.releaseIntentId) {
          const existingIntent = await transaction.getReleaseIntent(draft.releaseIntentId)
          if (!existingIntent)
            throw new RegistryAdminError('release_intent_missing')
          const sameEvidence = existingIntent.policyVersion === claims.policyVersion
            && existingIntent.contentHash === claims.contentHash
            && existingIntent.securityHash === claims.securityHash
          if (!sameEvidence)
            throw new RegistryAdminError('admin_approval_evidence_mismatch')

          if (existingIntent.baseCommitSha === baseCommitSha) {
            return {
              idempotent: true,
              releaseIntentId: draft.releaseIntentId,
              snapshotId: existingIntent.snapshotId,
              generation: existingIntent.generation,
              status: existingIntent.status,
            }
          }

          if (existingIntent.status !== 'superseded')
            throw new RegistryAdminError('admin_approval_evidence_mismatch')

          const current = await activeEnvelope(transaction)
          if (!current
            || draft.publishedSnapshotId !== existingIntent.snapshotId
            || current.state.activeSnapshotId !== existingIntent.snapshotId
            || current.state.generation !== existingIntent.generation
            || current.snapshot.policyVersion !== claims.policyVersion
            || current.snapshot.registry.clients.length !== claims.clientCount
            || current.snapshot.contentHash !== claims.contentHash
            || current.snapshot.securityHash !== claims.securityHash) {
            throw new RegistryAdminError('admin_approval_evidence_mismatch')
          }

          return queuePublishedRelease(transaction, {
            approvalId: `admin:${claims.jti}`,
            baseCommitSha,
            draftId: id,
            meta,
            published: {
              generation: current.state.generation,
              hashes: {
                contentHash: current.snapshot.contentHash,
                securityHash: current.snapshot.securityHash,
              },
              publishedAt: now(),
              snapshot: current.snapshot,
              snapshotId: current.snapshot.snapshotId,
            },
          })
        }
        if (draft.status !== 'draft')
          throw new RegistryAdminError('draft_unavailable')

        const registry = parseRegistry(draft.registry)
        const current = await activeEnvelope(transaction)
        const currentSnapshotId = current?.state.activeSnapshotId || null
        const hashes = hashRegistry(registry)
        if (draft.baseSnapshotId !== currentSnapshotId
          || registry.policyVersion !== claims.policyVersion
          || registry.clients.length !== claims.clientCount
          || hashes.contentHash !== claims.contentHash
          || hashes.securityHash !== claims.securityHash) {
          throw new RegistryAdminError('admin_approval_evidence_mismatch')
        }

        const published = draft.rollbackTargetSnapshotId
          ? await rollbackSnapshotTransaction(transaction, {
              draft,
              id,
              meta,
              targetSnapshotId: draft.rollbackTargetSnapshotId,
            })
          : await publishDraftTransaction(transaction, {
              draft,
              id,
              meta,
              auditAction: null,
            })
        return queuePublishedRelease(transaction, {
          approvalId: `admin:${claims.jti}`,
          baseCommitSha,
          draftId: id,
          meta,
          published,
        })
      })
    },

    async requestRollbackApproval(input) {
      const meta = requestMetadata(input)
      const targetSnapshotId = text(input?.targetSnapshotId, 'target_snapshot_required', 192)
      const baseCommitSha = commitSha(input?.baseCommitSha)
      const target = await store.getSnapshot(targetSnapshotId)
      if (!target)
        throw new RegistryAdminError('target_snapshot_not_found')
      let verifiedTarget
      try {
        verifiedTarget = parseRegistrySnapshotRecord(target, { environment })
      }
      catch (error) {
        throw new RegistryAdminError(error?.code || 'target_snapshot_invalid')
      }
      const targetKey = trustAnchors?.[environment]?.[verifiedTarget.keyId]
      if (!targetKey || !verifyRegistrySnapshotSignature(verifiedTarget, targetKey))
        throw new RegistryAdminError('target_snapshot_signature_invalid')
      const current = await activeEnvelope()
      if (!current)
        throw new RegistryAdminError('active_snapshot_missing')
      if (current.state.activeSnapshotId === targetSnapshotId)
        throw new RegistryAdminError('target_snapshot_already_active')
      const id = `draft:${randomId()}`
      await api.saveDraft({
        ...meta,
        draftId: id,
        baseSnapshotId: current.state.activeSnapshotId,
        registry: verifiedTarget.registry,
      })
      await store.updateDraft(id, { rollbackTargetSnapshotId: targetSnapshotId })
      if (environment === 'production') {
        return api.requestPublishApproval({
          ...meta,
          draftId: id,
          baseCommitSha,
          approverUid: input?.approverUid,
        })
      }
      return api.approveAndQueueRelease({
        ...meta,
        draftId: id,
        baseCommitSha,
      })
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
          const published = await publishDraftTransaction(transaction, {
            draft,
            id,
            meta,
            auditAction: 'publish_succeeded',
          })
          return {
            idempotent: false,
            snapshotId: published.snapshotId,
            envelope: published.envelope,
          }
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

    async getReleaseIntent(input) {
      requestMetadata(input)
      const releaseIntentId = text(input?.releaseIntentId, 'release_intent_id_required', 192)
      const intent = await store.getReleaseIntent(releaseIntentId)
      if (!intent)
        throw new RegistryAdminError('release_intent_not_found')
      const envelope = await activeEnvelope()
      if (!envelope
        || envelope.state.generation !== intent.generation
        || envelope.snapshot.snapshotId !== intent.snapshotId) {
        throw new RegistryAdminError('release_intent_not_active')
      }
      return { releaseIntentId, intent, envelope }
    },

    async recordCiProgress(input) {
      const meta = requestMetadata(input)
      const releaseIntentId = text(input?.releaseIntentId, 'release_intent_id_required', 192)
      const targetStatus = text(input?.status, 'release_status_required', 64)
      const transitions = {
        approved: new Set(['dispatched', 'ci_failed', 'superseded']),
        ci_failed: new Set(['dispatched', 'superseded']),
        dispatched: new Set(['pr_open', 'ci_failed', 'superseded']),
        pr_open: new Set(['merged', 'ci_failed', 'superseded']),
      }
      if (!['dispatched', 'pr_open', 'merged', 'ci_failed', 'superseded'].includes(targetStatus))
        throw new RegistryAdminError('release_status_invalid')
      return store.transaction(async (transaction) => {
        const intent = await transaction.getReleaseIntent(releaseIntentId)
        if (!intent)
          throw new RegistryAdminError('release_intent_not_found')
        if (intent.status === targetStatus)
          return { releaseIntentId, status: intent.status, idempotent: true }
        if (!transitions[intent.status]?.has(targetStatus))
          throw new RegistryAdminError('release_status_conflict')
        const updatedAt = now()
        const fields = { status: targetStatus, updatedAt }
        if (targetStatus === 'dispatched') {
          fields.githubRunId = text(input?.githubRunId, 'github_run_id_required', 64)
          fields.dispatchAttempts = Number(intent.dispatchAttempts || 0) + 1
        }
        if (targetStatus === 'pr_open') {
          const pullRequestNumber = Number(input?.pullRequestNumber)
          if (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber <= 0)
            throw new RegistryAdminError('pull_request_number_invalid')
          fields.pullRequestNumber = pullRequestNumber
        }
        if (targetStatus === 'merged')
          fields.mergeCommitSha = commitSha(input?.mergeCommitSha)
        if (targetStatus === 'ci_failed')
          fields.failureCode = optionalText(input?.failureCode, 'failure_code_invalid', 128) || 'ci_failed'
        await transaction.updateReleaseIntent(releaseIntentId, fields)
        await transaction.putAudit(auditId(updatedAt, randomId), {
          environment,
          action: `release_${targetStatus}`,
          operator: meta.operator,
          reason: meta.changeReason,
          releaseIntentId,
          requestId: meta.requestId,
          createdAt: updatedAt,
          details: { previousStatus: intent.status, ...fields },
        })
        return { releaseIntentId, status: targetStatus, idempotent: false, ...fields }
      })
    },

    async recordDeploymentResult(input) {
      const meta = requestMetadata(input)
      const releaseIntentId = text(input?.releaseIntentId, 'release_intent_id_required', 192)
      const targetStatus = text(input?.status, 'release_status_required', 64)
      if (!['deploying', 'deployed', 'deployment_failed'].includes(targetStatus))
        throw new RegistryAdminError('release_status_invalid')
      const targetCommitSha = commitSha(input?.mergeCommitSha)
      const consumers = deploymentConsumers(input?.deployedConsumers, targetStatus === 'deployed'
        ? {
            commitSha: targetCommitSha,
            required: environment === 'production'
              ? ['desktop-auth', 'sso-registry-admin', 'sso-ticket']
              : ['sso-registry-admin', 'sso-ticket'],
          }
        : {})
      return store.transaction(async (transaction) => {
        const intent = await transaction.getReleaseIntent(releaseIntentId)
        if (!intent)
          throw new RegistryAdminError('release_intent_not_found')
        if (intent.mergeCommitSha !== targetCommitSha)
          throw new RegistryAdminError('release_commit_mismatch')
        if (intent.status === targetStatus)
          return { releaseIntentId, status: intent.status, mergeCommitSha: targetCommitSha, idempotent: true }
        const allowed = (intent.status === 'merged' && targetStatus === 'deploying')
          || (intent.status === 'deployment_failed' && targetStatus === 'deploying')
          || (intent.status === 'deploying' && ['deployed', 'deployment_failed'].includes(targetStatus))
        if (!allowed)
          throw new RegistryAdminError('release_status_conflict')
        const updatedAt = now()
        const fields = {
          status: targetStatus,
          deployedConsumers: consumers,
          updatedAt,
          ...(targetStatus === 'deployed' ? { deployedAt: updatedAt, failureCode: null } : {}),
          ...(targetStatus === 'deployment_failed'
            ? { failureCode: optionalText(input?.failureCode, 'failure_code_invalid', 128) || 'deployment_failed' }
            : {}),
        }
        await transaction.updateReleaseIntent(releaseIntentId, fields)
        await transaction.putAudit(auditId(updatedAt, randomId), {
          environment,
          action: `release_${targetStatus}`,
          operator: meta.operator,
          reason: meta.changeReason,
          releaseIntentId,
          requestId: meta.requestId,
          createdAt: updatedAt,
          details: {
            previousStatus: intent.status,
            mergeCommitSha: targetCommitSha,
            deployedConsumers: consumers,
            ...(fields.failureCode ? { failureCode: fields.failureCode } : {}),
          },
        })
        return {
          releaseIntentId,
          status: targetStatus,
          mergeCommitSha: targetCommitSha,
          idempotent: false,
          ...fields,
        }
      })
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
  return api
}

module.exports = {
  RegistryAdminError,
  createRegistryAdminService,
}
