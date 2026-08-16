import { describe, expect, it } from 'vitest'
import { createRuntimeHandler } from '../api/handler.js'
import { createFakeRuntimeDependencies } from '../testing/fakes.js'

describe('adv.js ai runtime scaffold', () => {
  it('returns a minimal health response without configuration details', async () => {
    const dependencies = createFakeRuntimeDependencies()
    const handle = createRuntimeHandler(dependencies)

    const response = await handle({ method: 'GET', path: '/health', headers: {} })

    expect(response).toEqual({
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: {
        ok: true,
        protocolVersion: 1,
        service: 'advjs-ai-runtime',
      },
    })
    expect(JSON.stringify(response)).not.toContain('secret')
    expect(JSON.stringify(response)).not.toContain('model')
    expect(JSON.stringify(response)).not.toContain('environment')
  })

  it('runs the injected fake model without CloudBase or network access', async () => {
    const dependencies = createFakeRuntimeDependencies({ now: 1_723_599_000_000 })

    const result = await dependencies.modelExecutor.execute({
      attempt: 1,
      capability: 'generate-outline',
      input: { premise: 'A synthetic fixture' },
      model: 'fake-model',
      prompt: { system: 'Synthetic system prompt', user: 'Synthetic user prompt' },
      providerGroup: 'cloudbase',
      taskId: 'task_fixture_001',
      temperatureMilli: 700,
      timeoutMs: 60_000,
    })

    expect(result).toEqual({
      finishReason: 'stop',
      requestId: 'fake-request-task_fixture_001-1',
      streamText: '# Synthetic outline\n',
      usage: {
        cachedInputTokens: 0,
        inputTokens: 12,
        outputTokens: 8,
        reasoningTokens: 0,
      },
    })
    expect(dependencies.clock.now()).toBe(1_723_599_000_000)
  })

  it('keeps fake account and task state in memory', async () => {
    const dependencies = createFakeRuntimeDependencies()

    await dependencies.accountApi.reserve({
      idempotencyKey: 'reserve_fixture_001',
      microPoints: 20_000,
      taskId: 'task_fixture_001',
      uid: 'uid_fixture_001',
    })
    await dependencies.tasks.create({
      id: 'task_fixture_001',
      status: 'queued',
      uid: 'uid_fixture_001',
    })

    await expect(dependencies.tasks.get('task_fixture_001')).resolves.toEqual({
      id: 'task_fixture_001',
      status: 'queued',
      uid: 'uid_fixture_001',
    })
    await expect(dependencies.accountApi.getAccount('uid_fixture_001')).resolves.toMatchObject({
      activeTask: 'task_fixture_001',
      reservedMicroPoints: 20_000,
    })
  })
})
