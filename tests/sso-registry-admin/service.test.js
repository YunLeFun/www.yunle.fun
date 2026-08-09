import { generateKeyPairSync } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { createRegistryAdminService, RegistryAdminError } from '../../cloudfunctions/sso-registry-admin/service.js'
import { verifyRegistryReleaseIntent } from '../../packages/authorization-core/src/index'

function cloneMaps(source) {
  return Object.fromEntries(Object.entries(source).map(([name, values]) => [
    name,
    new Map([...values].map(([key, value]) => [key, structuredClone(value)])),
  ]))
}

function memoryStore() {
  let maps = {
    approvals: new Map(),
    intents: new Map(),
    outbox: new Map(),
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
      getApproval: async id => structuredClone(target().approvals.get(id) || null),
      putApproval: async (id, value) => target().approvals.set(id, structuredClone(value)),
      updateApproval: async (id, value) => target().approvals.set(id, {
        ...target().approvals.get(id),
        ...structuredClone(value),
      }),
      findPendingApprovalByDraft: async (environment, id) => [...target().approvals.entries()]
        .map(([approvalId, value]) => ({ approvalId, ...structuredClone(value) }))
        .find(value => value.environment === environment && value.draftId === id && ['delivery_pending', 'pending'].includes(value.status)) || null,
      getReleaseIntent: async id => structuredClone(target().intents.get(id) || null),
      putReleaseIntent: async (id, value) => target().intents.set(id, structuredClone(value)),
      updateReleaseIntent: async (id, value) => target().intents.set(id, {
        ...target().intents.get(id),
        ...structuredClone(value),
      }),
      putOutbox: async (id, value) => target().outbox.set(id, structuredClone(value)),
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

function registry(policyVersion = '2026-08-03.1', displayName = 'Sample', environment = 'production') {
  return {
    schemaVersion: 1,
    policyVersion,
    issuer: environment === 'development' ? 'https://www.yunle.localhost:3000' : 'https://www.yunle.fun',
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

function setup(options = {}) {
  const keys = generateKeyPairSync('ed25519')
  const memory = memoryStore()
  let clock = 1_785_700_000_000
  let sequence = 0
  const keyId = 'prod-registry-test'
  const environment = options.environment || 'production'
  const trustAnchors = {
    production: environment === 'production' ? { [keyId]: keys.publicKey.export({ format: 'jwk' }) } : {},
    development: environment === 'development' ? { [keyId]: keys.publicKey.export({ format: 'jwk' }) } : {},
  }
  const service = createRegistryAdminService({
    environment,
    keyId,
    signingKey: keys.privateKey,
    trustAnchors,
    store: memory.store,
    now: () => ++clock,
    randomId: () => `id-${++sequence}`,
    ...options,
  })
  return { memory, service, trustAnchors }
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

  it('preserves an existing draft base when another draft is published', async () => {
    const { service } = setup()
    const initialDraft = await service.saveDraft(request({ registry: registry() }))
    const initial = await service.publishDraft(request({ draftId: initialDraft.draftId }))

    const staleDraft = await service.saveDraft(request({
      registry: registry('2026-08-03.2', 'Stale edit'),
    }))
    const concurrentDraft = await service.saveDraft(request({
      registry: registry('2026-08-03.3', 'Concurrent edit'),
    }))
    await service.publishDraft(request({ draftId: concurrentDraft.draftId }))

    const updated = await service.saveDraft(request({
      draftId: staleDraft.draftId,
      registry: registry('2026-08-03.4', 'Updated stale edit'),
    }))

    expect(updated.draft.baseSnapshotId).toBe(initial.snapshotId)
    await expect(service.publishDraft(request({ draftId: staleDraft.draftId })))
      .rejects
      .toEqual(expect.objectContaining({ code: 'draft_base_conflict' }))
  })

  it('returns security and display diff classifications for a draft', async () => {
    const { service } = setup()
    const initialDraft = await service.saveDraft(request({ registry: registry() }))
    await service.publishDraft(request({ draftId: initialDraft.draftId }))
    const changed = registry('2026-08-08.2', 'Renamed')
    changed.clients[0].adapters[0].allowedScopes = ['identity:bootstrap', 'membership:read']
    const draft = await service.saveDraft(request({ registry: changed }))

    const result = await service.getDraftDiff(request({ draftId: draft.draftId }))

    expect(result.diffSummary).toEqual({
      added: [],
      displayChanged: ['sample-web'],
      modified: ['sample-web'],
      removed: [],
      securityChanged: ['sample-web'],
    })
  })

  it('requests production approval without persisting or returning the email code', async () => {
    const deliveries = []
    const { memory, service } = setup({
      approvalPepper: 'registry-approval-pepper-with-32-bytes',
      approverUids: ['admin-uid'],
      generateApprovalCode: () => '23456789ABCD',
      resolveApproverEmail: async uid => uid === 'admin-uid' ? 'admin@example.com' : null,
      sendApprovalEmail: async (message) => {
        deliveries.push(message)
        return { id: 'ses-message-1', requestId: 'ses-request-1' }
      },
    })
    const draft = await service.saveDraft(request({ registry: registry() }))

    const approval = await service.requestPublishApproval(request({
      draftId: draft.draftId,
      baseCommitSha: 'a'.repeat(40),
    }))

    expect(approval).toMatchObject({
      status: 'pending',
      recipientMasked: 'a***@example.com',
    })
    expect(approval).not.toHaveProperty('code')
    expect(deliveries).toEqual([expect.objectContaining({
      to: 'admin@example.com',
      code: '23456789ABCD',
      approvalId: approval.approvalId,
    })])
    const persisted = memory.snapshot().approvals.get(approval.approvalId)
    expect(persisted).toMatchObject({
      status: 'pending',
      approverUid: 'admin-uid',
      recipientMasked: 'a***@example.com',
      deliveryMessageId: 'ses-message-1',
    })
    expect(persisted).not.toHaveProperty('code')
    expect(persisted).not.toHaveProperty('email')
    expect(persisted.codeMac).toMatch(/^[a-f0-9]{64}$/)
    expect(persisted.recipientHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('consumes a valid production approval and atomically queues a signed release intent', async () => {
    let deliveredCode
    const { memory, service, trustAnchors } = setup({
      approvalPepper: 'registry-approval-pepper-with-32-bytes',
      approverUids: ['admin-uid'],
      generateApprovalCode: () => '23456789ABCD',
      resolveApproverEmail: async () => 'admin@example.com',
      sendApprovalEmail: async (message) => {
        deliveredCode = message.code
        return { id: 'ses-message-2' }
      },
    })
    const draft = await service.saveDraft(request({ registry: registry() }))
    const approval = await service.requestPublishApproval(request({
      draftId: draft.draftId,
      baseCommitSha: 'b'.repeat(40),
    }))

    const queued = await service.approveAndQueueRelease(request({
      approvalId: approval.approvalId,
      code: deliveredCode,
    }))

    expect(queued).toMatchObject({
      status: 'approved',
      generation: 1,
    })
    const state = memory.snapshot()
    expect(state.approvals.get(approval.approvalId)).toMatchObject({
      status: 'consumed',
      releaseIntentId: queued.releaseIntentId,
    })
    expect(state.intents.get(queued.releaseIntentId)).toMatchObject({
      environment: 'production',
      approvalId: approval.approvalId,
      snapshotId: queued.snapshotId,
      generation: 1,
      baseCommitSha: 'b'.repeat(40),
      status: 'approved',
      dispatchAttempts: 0,
    })
    expect(state.intents.get(queued.releaseIntentId).manifestSignature).toMatch(/^[\w-]+$/)
    expect(state.outbox.get(queued.releaseIntentId)).toMatchObject({
      releaseIntentId: queued.releaseIntentId,
      status: 'pending',
      attempts: 0,
    })
    expect(state.state.get('production').generation).toBe(1)
    const release = await service.getReleaseIntent(request({ releaseIntentId: queued.releaseIntentId }))
    expect(verifyRegistryReleaseIntent(release.intent, {
      environment: 'production',
      trustAnchors,
    })).toMatchObject({ snapshotId: queued.snapshotId, generation: 1 })
    expect(release.envelope).toMatchObject({
      state: { generation: 1 },
      snapshot: { snapshotId: queued.snapshotId },
    })
    expect([...state.audits.values()].map(item => item.action)).toEqual([
      'draft_saved',
      'approval_requested',
      'release_approved',
    ])
  })

  it('locks a production approval after five invalid codes without publishing', async () => {
    const { memory, service } = setup({
      approvalPepper: 'registry-approval-pepper-with-32-bytes',
      approverUids: ['admin-uid'],
      generateApprovalCode: () => '23456789ABCD',
      resolveApproverEmail: async () => 'admin@example.com',
      sendApprovalEmail: async () => ({ id: 'ses-message-lock' }),
    })
    const draft = await service.saveDraft(request({ registry: registry() }))
    const approval = await service.requestPublishApproval(request({
      draftId: draft.draftId,
      baseCommitSha: '4'.repeat(40),
    }))

    for (let attempt = 1; attempt <= 4; attempt++) {
      await expect(service.approveAndQueueRelease(request({
        approvalId: approval.approvalId,
        code: '23456789ABCE',
      }))).rejects.toEqual(expect.objectContaining({ code: 'approval_code_invalid' }))
    }
    await expect(service.approveAndQueueRelease(request({
      approvalId: approval.approvalId,
      code: '23456789ABCE',
    }))).rejects.toEqual(expect.objectContaining({ code: 'approval_locked' }))
    await expect(service.approveAndQueueRelease(request({
      approvalId: approval.approvalId,
      code: '23456789ABCD',
    }))).rejects.toEqual(expect.objectContaining({ code: 'approval_locked' }))

    const state = memory.snapshot()
    expect(state.approvals.get(approval.approvalId)).toMatchObject({ attempts: 5, status: 'locked' })
    expect(state.snapshots.size).toBe(0)
    expect(state.intents.size).toBe(0)
    expect(state.outbox.size).toBe(0)
  })

  it('rejects expired, delivery-failed and content-stale production approvals', async () => {
    let clock = 1_785_700_000_000
    const common = {
      approvalPepper: 'registry-approval-pepper-with-32-bytes',
      approverUids: ['admin-uid'],
      generateApprovalCode: () => '23456789ABCD',
      resolveApproverEmail: async () => 'admin@example.com',
      now: () => clock,
    }

    const deliveryFailure = setup({
      ...common,
      sendApprovalEmail: async () => { throw new Error('ses unavailable') },
    })
    const failedDraft = await deliveryFailure.service.saveDraft(request({ registry: registry() }))
    await expect(deliveryFailure.service.requestPublishApproval(request({
      draftId: failedDraft.draftId,
      baseCommitSha: '5'.repeat(40),
    }))).rejects.toEqual(expect.objectContaining({ code: 'approval_delivery_failed' }))
    expect([...deliveryFailure.memory.snapshot().approvals.values()]).toEqual([
      expect.objectContaining({ status: 'delivery_failed' }),
    ])

    const expiration = setup({
      ...common,
      sendApprovalEmail: async () => ({ id: 'ses-message-expired' }),
    })
    const expiringDraft = await expiration.service.saveDraft(request({ registry: registry() }))
    const expiredApproval = await expiration.service.requestPublishApproval(request({
      draftId: expiringDraft.draftId,
      baseCommitSha: '6'.repeat(40),
    }))
    clock += 30 * 60 * 1000 + 1
    await expect(expiration.service.approveAndQueueRelease(request({
      approvalId: expiredApproval.approvalId,
      code: '23456789ABCD',
    }))).rejects.toEqual(expect.objectContaining({ code: 'approval_expired' }))
    expect(expiration.memory.snapshot().approvals.get(expiredApproval.approvalId).status).toBe('expired')

    clock = 1_785_700_000_000
    const stale = setup({
      ...common,
      sendApprovalEmail: async () => ({ id: 'ses-message-stale' }),
    })
    const staleDraft = await stale.service.saveDraft(request({ registry: registry() }))
    const staleApproval = await stale.service.requestPublishApproval(request({
      draftId: staleDraft.draftId,
      baseCommitSha: '7'.repeat(40),
    }))
    await stale.service.saveDraft(request({
      draftId: staleDraft.draftId,
      registry: registry('2026-08-08.8', 'Changed after approval'),
    }))
    await expect(stale.service.approveAndQueueRelease(request({
      approvalId: staleApproval.approvalId,
      code: '23456789ABCD',
    }))).rejects.toEqual(expect.objectContaining({ code: 'approval_stale' }))
    expect(stale.memory.snapshot().approvals.get(staleApproval.approvalId).status).toBe('canceled')
    expect(stale.memory.snapshot().intents.size).toBe(0)
  })

  it('queues a development release without an email approval', async () => {
    const { memory, service } = setup({ environment: 'development' })
    const draft = await service.saveDraft(request({
      registry: registry('2026-08-08.dev.1', 'Development', 'development'),
    }))

    const queued = await service.approveAndQueueRelease(request({
      draftId: draft.draftId,
      baseCommitSha: 'c'.repeat(40),
    }))

    expect(queued).toMatchObject({ status: 'approved', generation: 1 })
    expect(memory.snapshot().intents.get(queued.releaseIntentId)).toMatchObject({
      environment: 'development',
      approvalId: null,
      baseCommitSha: 'c'.repeat(40),
      status: 'approved',
    })
  })

  it('uses signed Admin evidence to atomically queue a production release', async () => {
    const claims = {
      sub: 'admin-uid',
      login: 'registry-owner',
      draftId: 'draft:admin-approved',
      policyVersion: '2026-08-03.1',
      clientCount: 1,
      contentHash: '',
      securityHash: '',
      baseCommitSha: 'f'.repeat(40),
      changeReason: 'Approved after reviewing the exact Admin diff',
      jti: 'admin-proof-id',
    }
    const { memory, service } = setup({
      approverUids: ['admin-uid'],
      verifyAdminApprovalProof: proof => proof,
    })
    const saved = await service.saveDraft(request({
      draftId: claims.draftId,
      registry: registry(),
    }))
    const diff = await service.getDraftDiff(request({ draftId: saved.draftId }))
    claims.contentHash = diff.contentHash
    claims.securityHash = diff.securityHash

    const queued = await service.approveAndQueueReleaseByAdmin({
      approvalProof: claims,
      requestId: 'admin-request-id',
    })

    expect(queued).toMatchObject({ status: 'approved', generation: 1 })
    expect(memory.snapshot().intents.get(queued.releaseIntentId)).toMatchObject({
      approvalId: 'admin:admin-proof-id',
      baseCommitSha: 'f'.repeat(40),
      contentHash: diff.contentHash,
      securityHash: diff.securityHash,
    })
    expect([...memory.snapshot().audits.values()].at(-1)).toMatchObject({
      action: 'release_approved',
      operator: 'admin:registry-owner (admin-uid)',
      reason: claims.changeReason,
    })
  })

  it('requeues a superseded production release against the newly reviewed main commit', async () => {
    const claims = {
      sub: 'admin-uid',
      login: 'registry-owner',
      draftId: 'draft:admin-retry',
      policyVersion: '2026-08-03.1',
      clientCount: 1,
      contentHash: '',
      securityHash: '',
      baseCommitSha: 'a'.repeat(40),
      changeReason: 'Approved after reviewing the exact Admin diff',
      jti: 'admin-proof-initial',
    }
    const { memory, service } = setup({
      approverUids: ['admin-uid'],
      verifyAdminApprovalProof: proof => proof,
    })
    const saved = await service.saveDraft(request({
      draftId: claims.draftId,
      registry: registry(),
    }))
    const diff = await service.getDraftDiff(request({ draftId: saved.draftId }))
    claims.contentHash = diff.contentHash
    claims.securityHash = diff.securityHash

    const initial = await service.approveAndQueueReleaseByAdmin({
      approvalProof: claims,
      requestId: 'admin-request-initial',
    })
    await service.recordCiProgress(request({
      releaseIntentId: initial.releaseIntentId,
      status: 'superseded',
    }))

    claims.baseCommitSha = 'b'.repeat(40)
    claims.jti = 'admin-proof-retry'
    claims.changeReason = 'Reapproved after protected main moved'
    const retried = await service.approveAndQueueReleaseByAdmin({
      approvalProof: claims,
      requestId: 'admin-request-retry',
    })

    const data = memory.snapshot()
    expect(retried).toMatchObject({
      idempotent: false,
      generation: initial.generation,
      snapshotId: initial.snapshotId,
      status: 'approved',
    })
    expect(retried.releaseIntentId).not.toBe(initial.releaseIntentId)
    expect(data.intents.get(initial.releaseIntentId)).toMatchObject({ status: 'superseded' })
    expect(data.intents.get(retried.releaseIntentId)).toMatchObject({
      approvalId: 'admin:admin-proof-retry',
      baseCommitSha: 'b'.repeat(40),
      generation: initial.generation,
      snapshotId: initial.snapshotId,
      status: 'approved',
    })
    expect(data.drafts.get(saved.draftId)).toMatchObject({
      releaseIntentId: retried.releaseIntentId,
      publishedSnapshotId: initial.snapshotId,
      status: 'published',
    })
    expect(data.outbox.size).toBe(2)
  })

  it('rejects Admin evidence when the draft changes after review', async () => {
    const { service } = setup({
      approverUids: ['admin-uid'],
      verifyAdminApprovalProof: proof => proof,
    })
    const saved = await service.saveDraft(request({ registry: registry() }))
    const diff = await service.getDraftDiff(request({ draftId: saved.draftId }))
    await service.saveDraft(request({
      draftId: saved.draftId,
      registry: registry('2026-08-03.2', 'Changed after Admin review'),
    }))

    await expect(service.approveAndQueueReleaseByAdmin({
      approvalProof: {
        sub: 'admin-uid',
        login: 'registry-owner',
        draftId: saved.draftId,
        policyVersion: diff.policyVersion,
        clientCount: diff.clientCount,
        contentHash: diff.contentHash,
        securityHash: diff.securityHash,
        baseCommitSha: '1'.repeat(40),
        changeReason: 'Reviewed before mutation',
        jti: 'stale-admin-proof',
      },
      requestId: 'stale-admin-request',
    })).rejects.toEqual(expect.objectContaining({ code: 'admin_approval_evidence_mismatch' }))
  })

  it('records CI and deployment progress against the exact merge commit', async () => {
    const { memory, service } = setup({ environment: 'development' })
    const draft = await service.saveDraft(request({
      registry: registry('2026-08-08.dev.2', 'Development CI', 'development'),
    }))
    const queued = await service.approveAndQueueRelease(request({
      draftId: draft.draftId,
      baseCommitSha: 'd'.repeat(40),
    }))

    await service.recordCiProgress(request({
      releaseIntentId: queued.releaseIntentId,
      status: 'dispatched',
      githubRunId: '12345',
    }))
    await service.recordCiProgress(request({
      releaseIntentId: queued.releaseIntentId,
      status: 'pr_open',
      pullRequestNumber: 42,
    }))
    await service.recordCiProgress(request({
      releaseIntentId: queued.releaseIntentId,
      status: 'merged',
      mergeCommitSha: 'e'.repeat(40),
    }))
    await service.recordDeploymentResult(request({
      releaseIntentId: queued.releaseIntentId,
      status: 'deploying',
      mergeCommitSha: 'e'.repeat(40),
      deployedConsumers: {},
    }))
    const deployed = await service.recordDeploymentResult(request({
      releaseIntentId: queued.releaseIntentId,
      status: 'deployed',
      mergeCommitSha: 'e'.repeat(40),
      deployedConsumers: {
        'sso-registry-admin': 'e'.repeat(40),
        'sso-ticket': 'e'.repeat(40),
      },
    }))

    expect(deployed).toMatchObject({ status: 'deployed', mergeCommitSha: 'e'.repeat(40) })
    expect(memory.snapshot().intents.get(queued.releaseIntentId)).toMatchObject({
      status: 'deployed',
      mergeCommitSha: 'e'.repeat(40),
      deployedConsumers: {
        'sso-registry-admin': 'e'.repeat(40),
        'sso-ticket': 'e'.repeat(40),
      },
    })
  })

  it('requires every environment consumer to report the exact deployed commit', async () => {
    const { service } = setup({ environment: 'development' })
    const draft = await service.saveDraft(request({
      registry: registry('2026-08-08.dev.3', 'Development CI', 'development'),
    }))
    const queued = await service.approveAndQueueRelease(request({
      draftId: draft.draftId,
      baseCommitSha: '8'.repeat(40),
    }))
    await service.recordCiProgress(request({
      releaseIntentId: queued.releaseIntentId,
      status: 'dispatched',
      githubRunId: '67890',
    }))
    await service.recordCiProgress(request({
      releaseIntentId: queued.releaseIntentId,
      status: 'pr_open',
      pullRequestNumber: 43,
    }))
    await service.recordCiProgress(request({
      releaseIntentId: queued.releaseIntentId,
      status: 'merged',
      mergeCommitSha: '9'.repeat(40),
    }))
    await service.recordDeploymentResult(request({
      releaseIntentId: queued.releaseIntentId,
      status: 'deploying',
      mergeCommitSha: '9'.repeat(40),
      deployedConsumers: {},
    }))

    await expect(service.recordDeploymentResult(request({
      releaseIntentId: queued.releaseIntentId,
      status: 'deployed',
      mergeCommitSha: '9'.repeat(40),
      deployedConsumers: {},
    }))).rejects.toEqual(expect.objectContaining({ code: 'deployed_consumers_incomplete' }))
    await expect(service.recordDeploymentResult(request({
      releaseIntentId: queued.releaseIntentId,
      status: 'deployed',
      mergeCommitSha: '9'.repeat(40),
      deployedConsumers: {
        'sso-registry-admin': 'a'.repeat(40),
        'sso-ticket': 'a'.repeat(40),
      },
    }))).rejects.toEqual(expect.objectContaining({ code: 'deployed_consumer_commit_mismatch' }))

    await expect(service.recordDeploymentResult(request({
      releaseIntentId: queued.releaseIntentId,
      status: 'deployed',
      mergeCommitSha: '9'.repeat(40),
      deployedConsumers: {
        'sso-registry-admin': '9'.repeat(40),
        'sso-ticket': '9'.repeat(40),
        'www': '9'.repeat(40),
      },
    }))).rejects.toEqual(expect.objectContaining({ code: 'deployed_consumers_invalid' }))
  })

  it('queues development rollback through a higher generation release intent', async () => {
    const { memory, service } = setup({ environment: 'development' })
    const firstDraft = await service.saveDraft(request({
      registry: registry('2026-08-08.dev.3', 'First', 'development'),
    }))
    const first = await service.approveAndQueueRelease(request({
      draftId: firstDraft.draftId,
      baseCommitSha: '1'.repeat(40),
    }))
    const secondDraft = await service.saveDraft(request({
      registry: registry('2026-08-08.dev.4', 'Second', 'development'),
    }))
    await service.approveAndQueueRelease(request({
      draftId: secondDraft.draftId,
      baseCommitSha: '2'.repeat(40),
    }))

    const rollback = await service.requestRollbackApproval(request({
      targetSnapshotId: first.snapshotId,
      baseCommitSha: '3'.repeat(40),
    }))

    expect(rollback).toMatchObject({ status: 'approved', generation: 3, snapshotId: first.snapshotId })
    expect(memory.snapshot().state.get('development')).toMatchObject({
      action: 'rollback',
      generation: 3,
      activeSnapshotId: first.snapshotId,
    })
    expect(memory.snapshot().snapshots.size).toBe(2)
    expect(memory.snapshot().intents.get(rollback.releaseIntentId)).toMatchObject({
      approvalId: null,
      generation: 3,
      snapshotId: first.snapshotId,
    })
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
