import type { RuntimeDependencies } from '../dependencies.js'
import { describe, expect, it } from 'vitest'
import { createRuntimeApiHandler, InMemoryRateLimiter } from '../api/runtime-api.js'
import { TASK_RETENTION_MS } from '../domain/task.js'
import { createFakeRuntimeDependencies } from '../testing/fakes.js'

const ORIGIN = 'https://editor.advjs.org'

const CREATE_BODY = {
  capability: 'generate-outline',
  input: { premise: 'Synthetic fixture' },
  locale: 'zh-CN',
  project: {
    files: { 'adv/outline.md': '# Existing\n' },
    id: 'project_fixture_001',
    revision: 'revision_fixture_001',
  },
  protocolVersion: 1,
}

function createHarness(overrides: Partial<RuntimeDependencies> = {}, options: { rateLimit?: number } = {}) {
  const dependencies = { ...createFakeRuntimeDependencies(), ...overrides }
  const logs: unknown[] = []
  const handler = createRuntimeApiHandler(dependencies, {
    adminAuth: {
      verify: async (authorization, audience) => {
        if (authorization !== 'Service admin-fixture' || audience !== 'advjs-ai-runtime-admin')
          throw new Error('invalid service identity')
        return { actor: 'admin_fixture_001' }
      },
    },
    allowedOrigins: [ORIGIN],
    appId: 'advjs-studio-web',
    logger: { info: (_message, meta) => logs.push(meta) },
    rateLimiter: new InMemoryRateLimiter(options.rateLimit ?? 100, 60_000),
  })
  return { dependencies, handler, logs }
}

function request(
  handler: ReturnType<typeof createRuntimeApiHandler>,
  input: {
    body?: unknown
    headers?: Record<string, string>
    method?: string
    path?: string
  } = {},
) {
  return handler({
    method: input.method ?? 'POST',
    path: input.path ?? '/v1/tasks',
    headers: {
      'authorization': 'Bearer access-token-fixture',
      'content-type': 'application/json',
      'idempotency-key': 'create_fixture_001',
      'origin': ORIGIN,
      ...input.headers,
    },
    ...(input.body === undefined ? {} : { body: input.body }),
  })
}

describe('runtime REST API', () => {
  it('creates one authorized task and replays the same idempotent response', async () => {
    const { dependencies, handler, logs } = createHarness()

    const first = await request(handler, { body: CREATE_BODY })
    const replay = await request(handler, { body: CREATE_BODY })

    expect(first.status).toBe(201)
    expect((replay.body as { data: unknown }).data).toEqual((first.body as { data: unknown }).data)
    expect(first.body).toMatchObject({
      data: {
        eventsUrl: expect.stringMatching(/^\/v1\/tasks\/.+\/events$/),
        reservedMicroPoints: 8_000,
        status: 'queued',
      },
      protocolVersion: 1,
    })
    const tasks = await dependencies.tasks.list()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.expiresAt).toBe(dependencies.clock.now() + TASK_RETENTION_MS)
    expect(JSON.stringify(logs)).not.toContain('Synthetic fixture')
    expect(JSON.stringify(logs)).not.toContain('access-token-fixture')
  })

  it('rejects idempotency conflicts and client-controlled identity or model policy', async () => {
    const { dependencies, handler } = createHarness()
    await request(handler, { body: CREATE_BODY })

    const conflict = await request(handler, {
      body: { ...CREATE_BODY, input: { premise: 'Different semantics' } },
    })
    const forbidden = await request(handler, {
      body: { ...CREATE_BODY, input: { model: 'client-model' } },
      headers: { 'idempotency-key': 'create_fixture_002' },
    })
    const unsafe = await request(handler, {
      body: { ...CREATE_BODY, input: { premise: '描写未成年人色情性行为' } },
      headers: { 'idempotency-key': 'create_fixture_unsafe' },
    })

    expect(conflict).toMatchObject({
      status: 409,
      body: { error: { code: 'IDEMPOTENCY_CONFLICT' } },
    })
    expect(forbidden).toMatchObject({
      status: 400,
      body: { error: { code: 'INVALID_CAPABILITY_INPUT' } },
    })
    expect(unsafe).toMatchObject({
      status: 422,
      body: { error: { code: 'CONTENT_BLOCKED_MINOR' } },
    })
    await expect(dependencies.tasks.list()).resolves.toHaveLength(1)
  })

  it('enforces exact origin, bearer authentication, ownership and CORS headers', async () => {
    const { dependencies, handler } = createHarness()
    const created = await request(handler, { body: CREATE_BODY })
    const taskId = (created.body as { data: { taskId: string } }).data.taskId

    const wrongOrigin = await request(handler, { body: CREATE_BODY, headers: { origin: 'https://evil.invalid' } })
    const noBearer = await request(handler, { body: CREATE_BODY, headers: { authorization: '' } })
    const preflight = await request(handler, {
      method: 'OPTIONS',
      path: '/v1/tasks',
      headers: {
        authorization: '',
        origin: ORIGIN,
      },
    })
    const otherUserDependencies = {
      ...dependencies,
      auth: { verifyAccessToken: async () => ({ uid: 'uid_other_fixture' }) },
    }
    const otherUser = createRuntimeApiHandler(otherUserDependencies, {
      allowedOrigins: [ORIGIN],
      appId: 'advjs-studio-web',
    })
    const forbiddenRead = await request(otherUser, { method: 'GET', path: `/v1/tasks/${taskId}` })
    const ownTask = await request(handler, { method: 'GET', path: `/v1/tasks/${taskId}` })

    expect(wrongOrigin).toMatchObject({ status: 403, body: { error: { code: 'ORIGIN_FORBIDDEN' } } })
    expect(noBearer).toMatchObject({ status: 401, body: { error: { code: 'AUTH_REQUIRED' } } })
    expect(preflight).toMatchObject({
      status: 204,
      headers: {
        'access-control-allow-origin': ORIGIN,
        'vary': 'Origin',
      },
    })
    expect(preflight.headers['access-control-allow-origin']).not.toBe('*')
    expect(forbiddenRead).toMatchObject({ status: 404, body: { error: { code: 'TASK_NOT_FOUND' } } })
    expect(ownTask).toMatchObject({
      status: 200,
      body: {
        data: {
          protocolVersion: 1,
          taskId,
          projectId: CREATE_BODY.project.id,
          projectRevision: CREATE_BODY.project.revision,
          points: { reservedMicroPoints: 8_000, chargedMicroPoints: 0 },
        },
      },
    })
  })

  it('proxies own points, cancels idempotently and rejects oversized or rate-limited requests', async () => {
    const { handler } = createHarness()
    const created = await request(handler, { body: CREATE_BODY })
    const taskId = (created.body as { data: { taskId: string } }).data.taskId

    const points = await request(handler, { method: 'GET', path: '/v1/points/me' })
    const cancelled = await request(handler, {
      method: 'POST',
      path: `/v1/tasks/${taskId}/cancel`,
      headers: { 'idempotency-key': 'cancel_fixture_001' },
    })
    const cancelledReplay = await request(handler, {
      method: 'POST',
      path: `/v1/tasks/${taskId}/cancel`,
      headers: { 'idempotency-key': 'cancel_fixture_001' },
    })
    const oversized = await request(handler, {
      body: { ...CREATE_BODY, input: { premise: 'x'.repeat(70_000) } },
      headers: { 'idempotency-key': 'create_oversized' },
    })
    const limitedHarness = createHarness({}, { rateLimit: 1 })
    await request(limitedHarness.handler, { method: 'GET', path: '/v1/points/me' })
    const limited = await request(limitedHarness.handler, { method: 'GET', path: '/v1/points/me' })

    expect(points).toMatchObject({ status: 200, body: { data: { reservedMicroPoints: 8_000 } } })
    expect(cancelled).toMatchObject({
      status: 200,
      body: {
        data: {
          protocolVersion: 1,
          status: 'cancelled',
          points: { reservedMicroPoints: 0, chargedMicroPoints: 0 },
        },
      },
    })
    expect((cancelledReplay.body as { data: unknown }).data).toEqual((cancelled.body as { data: unknown }).data)
    expect(oversized).toMatchObject({ status: 413, body: { error: { code: 'REQUEST_TOO_LARGE' } } })
    expect(limited).toMatchObject({ status: 429, body: { error: { code: 'RATE_LIMITED' } } })
  })

  it('uses a dedicated service identity for internal policy access', async () => {
    const { handler } = createHarness()

    const browserToken = await request(handler, {
      method: 'GET',
      path: '/internal/v1/policy',
    })
    const serviceToken = await request(handler, {
      method: 'GET',
      path: '/internal/v1/policy',
      headers: {
        authorization: 'Service admin-fixture',
        origin: '',
      },
    })

    expect(browserToken).toMatchObject({ status: 403, body: { error: { code: 'ORIGIN_FORBIDDEN' } } })
    expect(serviceToken).toMatchObject({
      status: 200,
      body: { data: { id: 'policy:active', updatedBy: expect.any(String) } },
    })
  })

  it('lists filtered admin task summaries without exposing creative or provider request data', async () => {
    const { dependencies, handler } = createHarness()
    const created = await request(handler, { body: CREATE_BODY })
    const taskId = (created.body as { data: { taskId: string } }).data.taskId
    const policy = await dependencies.runtimeControl.getActivePolicy()
    expect(policy).toBeDefined()
    await dependencies.tasks.update(taskId, task => ({
      ...task,
      model: 'fake-model',
      providerCostMicroCny: 21,
      streamText: 'private streamed draft',
    }))
    await dependencies.usage.append({
      taskId,
      uid: 'uid_fixture_001',
      appId: 'advjs-studio-web',
      capability: 'generate-outline',
      attempt: 1,
      providerGroup: 'cloudbase',
      model: 'fake-model',
      providerRequestId: 'provider-secret-fixture',
      usage: {
        inputTokens: 11,
        outputTokens: 7,
        cachedInputTokens: 3,
        reasoningTokens: 2,
      },
      pricing: policy!.pricing,
      providerCostMicroCny: 21,
      userChargeMicroPoints: 42,
      billingResponsibility: 'user',
      outcome: 'success',
      createdAt: 1_723_599_000_000,
    })

    const response = await request(handler, {
      method: 'GET',
      path: '/internal/v1/tasks?uid=uid_fixture_001&capability=generate-outline&from=2024-08-14&to=2024-08-14&limit=20',
      headers: { authorization: 'Service admin-fixture', origin: '' },
    })
    const serialized = JSON.stringify(response.body)

    expect(response).toMatchObject({
      status: 200,
      body: {
        data: {
          items: [{
            taskId,
            requestId: 'create_fixture_001',
            uid: 'uid_fixture_001',
            appId: 'advjs-studio-web',
            model: 'fake-model',
            usage: {
              inputTokens: 11,
              outputTokens: 7,
              cachedInputTokens: 3,
              reasoningTokens: 2,
              providerCostMicroCny: 21,
              userChargeMicroPoints: 42,
              attempts: 1,
            },
          }],
          total: 1,
        },
      },
    })
    expect(serialized).not.toContain('Synthetic fixture')
    expect(serialized).not.toContain('private streamed draft')
    expect(serialized).not.toContain('provider-secret-fixture')
  })

  it('updates the runtime kill switch idempotently with immutable audit context', async () => {
    const { handler } = createHarness()
    const input = {
      method: 'POST',
      path: '/internal/v1/policy',
      body: { enabled: false, operator: 'yunyoujun', reason: '紧急停止托管 AI 服务' },
      headers: {
        'authorization': 'Service admin-fixture',
        'idempotency-key': 'policy_disable_fixture_001',
        'origin': '',
      },
    }
    const first = await request(handler, input)
    const replay = await request(handler, input)
    const conflict = await request(handler, {
      ...input,
      body: { enabled: true, operator: 'yunyoujun', reason: '恢复托管 AI 服务' },
    })
    const missingReason = await request(handler, {
      ...input,
      body: { enabled: true, operator: 'yunyoujun' },
      headers: { ...input.headers, 'idempotency-key': 'policy_missing_reason_fixture' },
    })

    expect(first).toMatchObject({
      status: 200,
      body: {
        data: {
          enabled: false,
          updatedBy: 'yunyoujun',
          updateServiceActor: 'admin_fixture_001',
          updateReason: '紧急停止托管 AI 服务',
          updateIdempotencyKey: 'policy_disable_fixture_001',
          updateFingerprint: expect.any(String),
        },
      },
    })
    expect((replay.body as { data: unknown }).data).toEqual((first.body as { data: unknown }).data)
    expect(conflict).toMatchObject({ status: 409, body: { error: { code: 'IDEMPOTENCY_CONFLICT' } } })
    expect(missingReason).toMatchObject({ status: 400, body: { error: { code: 'REASON_REQUIRED' } } })
  })

  it('records idempotent manual reconciliation requests and reports the daily control overview', async () => {
    const { dependencies, handler } = createHarness()
    const created = await request(handler, { body: CREATE_BODY })
    const taskId = (created.body as { data: { taskId: string } }).data.taskId
    await dependencies.tasks.update(taskId, task => ({
      ...task,
      status: 'reconcile_required',
      billingStatus: 'reconcile_required',
      errorCode: 'SETTLEMENT_UNCERTAIN',
    }))
    const reconcileInput = {
      method: 'POST',
      path: `/internal/v1/tasks/${taskId}/reconcile`,
      body: { operator: 'yunyoujun', reason: '核对该任务的冻结与结算记录' },
      headers: {
        'authorization': 'Service admin-fixture',
        'idempotency-key': 'reconcile_fixture_001',
        'origin': '',
      },
    }
    const first = await request(handler, reconcileInput)
    const replay = await request(handler, reconcileInput)
    const overview = await request(handler, {
      method: 'GET',
      path: '/internal/v1/runtime/overview?date=2024-08-14',
      headers: { authorization: 'Service admin-fixture', origin: '' },
    })

    expect(first).toMatchObject({
      status: 202,
      body: {
        data: {
          taskId,
          reconcile: {
            requestedBy: 'yunyoujun',
            serviceActor: 'admin_fixture_001',
            reason: '核对该任务的冻结与结算记录',
            requestedAt: expect.any(Number),
          },
        },
      },
    })
    expect((replay.body as { data: unknown }).data).toEqual((first.body as { data: unknown }).data)
    expect(overview).toMatchObject({
      status: 200,
      body: {
        data: {
          dateKey: '2024-08-14',
          access: { betaOnly: true, mode: 'ai-point-grant' },
          budget: { capMicroCny: expect.any(Number), remainingProviderCostMicroCny: expect.any(Number) },
          tasks: { total: 1, reconcileQueue: 1, statusCounts: { reconcile_required: 1 } },
        },
      },
    })
  })
})
