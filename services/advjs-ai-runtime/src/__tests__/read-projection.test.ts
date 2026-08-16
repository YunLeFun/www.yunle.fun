import type { RuntimeDependencies } from '../dependencies.js'
import { describe, expect, it } from 'vitest'
import { createRuntimeApiHandler } from '../api/runtime-api.js'
import { createFakeRuntimeDependencies } from '../testing/fakes.js'

const TASK_ID = 'task_projection_fixture_001'
const OWNER_TOKEN = 'owner-access-token-fixture'
const PROJECTION_AUTHORIZATION = 'Bearer projection-service-token-fixture'

async function createHarness() {
  const dependencies = createFakeRuntimeDependencies()
  const policy = await dependencies.runtimeControl.getActivePolicy()
  expect(policy).toBeDefined()
  await dependencies.tasks.create({
    id: TASK_ID,
    uid: 'uid_owner_fixture',
    status: 'completed',
    version: 7,
    appId: 'advjs-studio-web',
    clientRequestId: 'request_fixture_001',
    requestHash: 'request_hash_fixture_001',
    capability: 'generate-outline',
    input: { premise: 'private input' },
    projectId: 'project_fixture_001',
    projectRevision: 'revision_fixture_001',
    proposal: {
      summary: 'safe result',
      projectRevision: 'revision_fixture_001',
      patches: [],
      diagnostics: [],
    },
    billingStatus: 'settled',
    reservedMicroPoints: 8_000,
    chargedMicroPoints: 42,
    providerCostMicroCny: 21,
    streamText: 'completed text',
    streamRevision: 3,
    attempt: 1,
    leaseOwner: 'must-not-leak',
    model: 'must-not-leak',
    pricing: policy!.pricing,
    createdAt: 100,
    updatedAt: 200,
    completedAt: 200,
    expiresAt: 300,
  })
  await dependencies.usage.append({
    taskId: TASK_ID,
    uid: 'uid_owner_fixture',
    appId: 'advjs-studio-web',
    capability: 'generate-outline',
    attempt: 1,
    providerGroup: 'cloudbase',
    model: 'must-not-leak',
    providerRequestId: 'must-not-leak',
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
    createdAt: 200,
  })
  const authorizationChecks: string[] = []
  const auth: RuntimeDependencies['auth'] = {
    async verifyAccessToken(accessToken) {
      if (accessToken === OWNER_TOKEN)
        return { uid: 'uid_owner_fixture' }
      if (accessToken === 'other-access-token-fixture')
        return { uid: 'uid_other_fixture' }
      throw new Error('invalid user token')
    },
  }
  const handler = createRuntimeApiHandler({ ...dependencies, auth }, {
    appId: 'advjs-studio-web',
    allowedOrigins: ['https://editor.advjs.org'],
    adminAuth: {
      async verify(authorization, audience) {
        if (authorization !== 'Bearer admin-service-token-fixture' || audience !== 'advjs-ai-runtime-admin')
          throw new Error('invalid admin token')
        return { actor: 'admin_fixture' }
      },
    },
    readProjectionAuth: {
      async verify(authorization, audience) {
        authorizationChecks.push(`${authorization}:${audience}`)
        if (authorization !== PROJECTION_AUTHORIZATION || audience !== 'advjs-ai-runtime-read-projection')
          throw new Error('invalid projection token')
        return { actor: 'ai_runtime_shadow' }
      },
    },
  })
  return { authorizationChecks, handler }
}

function projectionRequest(
  handler: Awaited<ReturnType<typeof createHarness>>['handler'],
  input: { method?: string, serviceAuthorization?: string, userAuthorization?: string, origin?: string } = {},
) {
  return handler({
    method: input.method ?? 'GET',
    path: `/internal/v1/read-projection/tasks/${TASK_ID}`,
    headers: {
      authorization: input.serviceAuthorization ?? PROJECTION_AUTHORIZATION,
      'x-yunlefun-user-authorization': input.userAuthorization ?? `Bearer ${OWNER_TOKEN}`,
      ...(input.origin === undefined ? {} : { origin: input.origin }),
    },
  })
}

describe('read-only task projection broker', () => {
  it('double-authenticates the owner and returns a strict task/usage field whitelist', async () => {
    const { authorizationChecks, handler } = await createHarness()
    const response = await projectionRequest(handler)

    expect(response).toMatchObject({
      status: 200,
      body: {
        data: {
          schemaVersion: 1,
          task: {
            schemaVersion: 1,
            id: TASK_ID,
            status: 'completed',
            capability: 'generate-outline',
            streamText: 'completed text',
            attempt: 1,
            chargedMicroPoints: 42,
          },
          usage: {
            inputTokens: 11,
            outputTokens: 7,
            cachedInputTokens: 3,
            reasoningTokens: 2,
            totalTokens: 23,
            providerCostMicroCny: 21,
            chargedMicroPoints: 42,
          },
        },
      },
    })
    expect(authorizationChecks).toEqual([
      `${PROJECTION_AUTHORIZATION}:advjs-ai-runtime-read-projection`,
    ])
    const serialized = JSON.stringify(response.body)
    expect(serialized).not.toContain('uid_owner_fixture')
    expect(serialized).not.toContain('must-not-leak')
    expect(serialized).not.toContain('leaseOwner')
    expect(serialized).not.toContain('pricing')
    expect(serialized).not.toContain('providerRequestId')
  })

  it('hides non-owner tasks and rejects missing user or wrong service credentials', async () => {
    const { handler } = await createHarness()

    await expect(projectionRequest(handler, { userAuthorization: 'Bearer other-access-token-fixture' }))
      .resolves.toMatchObject({ status: 404, body: { error: { code: 'TASK_NOT_FOUND' } } })
    await expect(projectionRequest(handler, { userAuthorization: '' }))
      .resolves.toMatchObject({ status: 401, body: { error: { code: 'USER_AUTH_REQUIRED' } } })
    await expect(projectionRequest(handler, { serviceAuthorization: 'Bearer wrong-service-token' }))
      .resolves.toMatchObject({ status: 401, body: { error: { code: 'READ_PROJECTION_AUTH_REQUIRED' } } })
  })

  it('rejects mutation methods before authentication and cannot reuse the token on admin routes', async () => {
    const { authorizationChecks, handler } = await createHarness()

    const mutation = await projectionRequest(handler, { method: 'POST' })
    const adminMutation = await handler({
      method: 'POST',
      path: '/internal/v1/policy',
      headers: { authorization: PROJECTION_AUTHORIZATION },
      body: { enabled: false },
    })
    const browser = await projectionRequest(handler, { origin: 'https://editor.advjs.org' })

    expect(mutation).toMatchObject({
      status: 405,
      body: { error: { code: 'READ_PROJECTION_READ_ONLY' } },
    })
    expect(authorizationChecks).toEqual([])
    expect(adminMutation).toMatchObject({
      status: 401,
      body: { error: { code: 'SERVICE_AUTH_REQUIRED' } },
    })
    expect(browser).toMatchObject({ status: 403, body: { error: { code: 'ORIGIN_FORBIDDEN' } } })
  })
})
