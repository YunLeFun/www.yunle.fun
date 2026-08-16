import type { RuntimeDependencies } from '../dependencies.js'
import type { ModelExecutionRequest, ModelExecutionResult, ModelExecutor } from '../executors/types.js'
import { describe, expect, it } from 'vitest'
import { ModelExecutionError, ModelExecutionUncertainError } from '../executors/errors.js'
import { createFakeRuntimeDependencies } from '../testing/fakes.js'
import { RuntimeTaskService } from '../worker/task-service.js'
import { RuntimeWorker } from '../worker/worker.js'

const TASK_INPUT = {
  appId: 'advjs-studio-web',
  capability: 'generate-outline' as const,
  input: { premise: 'Synthetic fixture' },
  maxAutomaticAttempts: 2,
  maxUsage: { inputTokens: 20, outputTokens: 20 },
  uid: 'uid_fixture_001',
}

class EmptyCandidateExecutor implements ModelExecutor {
  execute = async (request: ModelExecutionRequest): Promise<ModelExecutionResult> => ({
    finishReason: 'stop',
    requestId: `empty-${request.taskId}-${request.attempt}`,
    streamText: '',
    usage: {
      cachedInputTokens: 0,
      inputTokens: 4,
      outputTokens: 2,
      reasoningTokens: 0,
    },
  })
}

class BlockedCandidateExecutor implements ModelExecutor {
  execute = async (request: ModelExecutionRequest): Promise<ModelExecutionResult> => ({
    finishReason: 'stop',
    requestId: `blocked-${request.taskId}-${request.attempt}`,
    streamText: '# 描写未成年人色情性行为',
    usage: {
      cachedInputTokens: 0,
      inputTokens: 4,
      outputTokens: 3,
      reasoningTokens: 0,
    },
  })
}

class RetryOnceExecutor implements ModelExecutor {
  #attempts = 0

  execute = async (request: ModelExecutionRequest): Promise<ModelExecutionResult> => {
    this.#attempts += 1
    if (this.#attempts === 1) {
      throw new ModelExecutionError('Synthetic rate limit', {
        requestId: `retry-${request.taskId}-1`,
        retryable: true,
        usage: {
          cachedInputTokens: 0,
          inputTokens: 3,
          outputTokens: 1,
          reasoningTokens: 0,
        },
      })
    }

    return {
      finishReason: 'stop',
      requestId: `success-${request.taskId}-2`,
      streamText: '# Recovered outline\n',
      usage: {
        cachedInputTokens: 0,
        inputTokens: 5,
        outputTokens: 2,
        reasoningTokens: 0,
      },
    }
  }
}

class UncertainExecutor implements ModelExecutor {
  execute = async (request: ModelExecutionRequest): Promise<ModelExecutionResult> => {
    throw new ModelExecutionUncertainError('Synthetic stream interruption', {
      requestId: `uncertain-${request.taskId}-${request.attempt}`,
      usage: {
        cachedInputTokens: 1,
        inputTokens: 3,
        outputTokens: 2,
        reasoningTokens: 1,
      },
    })
  }
}

class DeferredExecutor implements ModelExecutor {
  readonly started: Promise<void>
  #markStarted!: () => void
  #resolve!: (result: ModelExecutionResult) => void

  constructor() {
    this.started = new Promise(resolve => this.#markStarted = resolve)
  }

  execute = async (_request: ModelExecutionRequest): Promise<ModelExecutionResult> => {
    this.#markStarted()
    return new Promise(resolve => this.#resolve = resolve)
  }

  finish(taskId: string): void {
    this.#resolve({
      finishReason: 'stop',
      requestId: `cancel-${taskId}-1`,
      streamText: '# Partial outline\n',
      usage: {
        cachedInputTokens: 0,
        inputTokens: 4,
        outputTokens: 3,
        reasoningTokens: 0,
      },
    })
  }
}

class StreamingDeferredExecutor implements ModelExecutor {
  readonly streamed: Promise<void>
  #markStreamed!: () => void
  #finish!: () => void

  constructor() {
    this.streamed = new Promise(resolve => this.#markStreamed = resolve)
  }

  execute = async (request: ModelExecutionRequest): Promise<ModelExecutionResult> => {
    await request.onTextDelta?.('# 章节')
    await request.onTextDelta?.('\uD83D')
    await request.onTextDelta?.('\uDE00完成')
    this.#markStreamed()
    await new Promise<void>(resolve => this.#finish = resolve)
    return {
      finishReason: 'stop',
      requestId: `stream-${request.taskId}-${request.attempt}`,
      streamText: '# 章节😀完成',
      usage: {
        cachedInputTokens: 0,
        inputTokens: 4,
        outputTokens: 4,
        reasoningTokens: 0,
      },
    }
  }

  finish(): void {
    this.#finish()
  }
}

function createServices(overrides: Partial<RuntimeDependencies> = {}) {
  const dependencies = { ...createFakeRuntimeDependencies(), ...overrides }
  return {
    dependencies,
    tasks: new RuntimeTaskService(dependencies),
    worker: new RuntimeWorker(dependencies, {
      leaseDurationMs: 30_000,
      owner: 'worker_fixture_001',
    }),
  }
}

describe('durable runtime worker', () => {
  it('rejects a second active task before any model call', async () => {
    let modelCalls = 0
    const modelExecutor: ModelExecutor = {
      execute: async () => {
        modelCalls += 1
        throw new Error('Model must not be called during authorization')
      },
    }
    const { dependencies, tasks } = createServices({ modelExecutor })
    const active = await tasks.create(TASK_INPUT)

    await expect(tasks.create(TASK_INPUT)).rejects.toThrowError(/active task/i)

    expect(modelCalls).toBe(0)
    await expect(dependencies.accountApi.getAccount(TASK_INPUT.uid)).resolves.toMatchObject({
      activeTask: active.id,
      reservedMicroPoints: 40,
    })
    await expect(dependencies.tasks.list()).resolves.toMatchObject([
      { id: active.id, status: 'queued' },
      { billingStatus: 'none', status: 'failed' },
    ])
  })

  it('authorizes, executes and settles a successful task', async () => {
    const { dependencies, tasks, worker } = createServices()
    const task = await tasks.create(TASK_INPUT)

    expect(task).toMatchObject({
      billingStatus: 'reserved',
      status: 'queued',
      executor: 'model',
      model: 'fake-model',
      providerGroup: 'cloudbase',
      promptVersion: 'generate-outline-prompt-v1',
      parserVersion: 'generate-outline-parser-v1',
      safetyVersion: 'authoring-safety-v1',
    })
    await expect(worker.runOnce()).resolves.toBe(true)

    await expect(dependencies.tasks.get(task.id)).resolves.toMatchObject({
      attempt: 1,
      billingStatus: 'settled',
      chargedMicroPoints: 20,
      status: 'completed',
    })
    await expect(dependencies.usage.listByTask(task.id)).resolves.toMatchObject([{
      model: 'fake-model',
      providerGroup: 'cloudbase',
    }])
    const account = await dependencies.accountApi.getAccount(TASK_INPUT.uid)
    expect(account).toMatchObject({
      availableMicroPoints: 999_980,
      reservedMicroPoints: 0,
    })
    expect(account).not.toHaveProperty('activeTask')
  })

  it('buffers raw deltas until safety validation then publishes one recoverable candidate', async () => {
    const modelExecutor = new StreamingDeferredExecutor()
    const { dependencies, tasks, worker } = createServices({ modelExecutor })
    const task = await tasks.create(TASK_INPUT)

    const running = worker.runOnce()
    await modelExecutor.streamed

    await expect(dependencies.tasks.get(task.id)).resolves.toMatchObject({
      status: 'running',
      streamRevision: 0,
      streamText: '',
    })

    modelExecutor.finish()
    await running
    await expect(dependencies.tasks.get(task.id)).resolves.toMatchObject({
      status: 'completed',
      streamRevision: 1,
      streamText: '# 章节😀完成\n',
    })
  })

  it('charges automatic retry cost to the platform and the successful attempt to the user', async () => {
    const modelExecutor = new RetryOnceExecutor()
    const { dependencies, tasks, worker } = createServices({ modelExecutor })
    const task = await tasks.create(TASK_INPUT)

    await worker.runOnce()
    await expect(dependencies.tasks.get(task.id)).resolves.toMatchObject({ attempt: 1, status: 'queued' })
    await worker.runOnce()

    await expect(dependencies.tasks.get(task.id)).resolves.toMatchObject({
      attempt: 2,
      chargedMicroPoints: 7,
      providerCostMicroCny: 11,
      status: 'completed',
    })
    await expect(dependencies.usage.listByTask(task.id)).resolves.toMatchObject([
      { attempt: 1, billingResponsibility: 'platform', providerCostMicroCny: 4 },
      { attempt: 2, billingResponsibility: 'user', providerCostMicroCny: 7 },
    ])
    await expect(dependencies.accountApi.getAccount(TASK_INPUT.uid)).resolves.toMatchObject({
      availableMicroPoints: 999_993,
      reservedMicroPoints: 0,
    })
  })

  it('releases user points when no usable candidate exists', async () => {
    const { dependencies, tasks, worker } = createServices({ modelExecutor: new EmptyCandidateExecutor() })
    const task = await tasks.create({ ...TASK_INPUT, maxAutomaticAttempts: 1 })

    await worker.runOnce()

    await expect(dependencies.tasks.get(task.id)).resolves.toMatchObject({
      billingStatus: 'released',
      chargedMicroPoints: 0,
      providerCostMicroCny: 6,
      status: 'failed',
    })
    const account = await dependencies.accountApi.getAccount(TASK_INPUT.uid)
    expect(account).toMatchObject({
      availableMicroPoints: 1_000_000,
      reservedMicroPoints: 0,
    })
    expect(account).not.toHaveProperty('activeTask')
  })

  it('blocks unsafe output before delivery and charges its usage to the platform', async () => {
    const { dependencies, tasks, worker } = createServices({ modelExecutor: new BlockedCandidateExecutor() })
    const task = await tasks.create({ ...TASK_INPUT, maxAutomaticAttempts: 1 })

    await worker.runOnce()

    await expect(dependencies.tasks.get(task.id)).resolves.toMatchObject({
      billingStatus: 'released',
      chargedMicroPoints: 0,
      errorCode: 'CONTENT_BLOCKED_MINOR',
      status: 'blocked',
      streamText: '',
    })
    await expect(dependencies.usage.listByTask(task.id)).resolves.toMatchObject([
      { billingResponsibility: 'platform', outcome: 'blocked' },
    ])
  })

  it('settles confirmed partial usage when cancellation races with execution', async () => {
    const modelExecutor = new DeferredExecutor()
    const { dependencies, tasks, worker } = createServices({ modelExecutor })
    const task = await tasks.create(TASK_INPUT)
    const running = worker.runOnce()
    await modelExecutor.started

    await tasks.cancel(task.id)
    modelExecutor.finish(task.id)
    await running

    await expect(dependencies.tasks.get(task.id)).resolves.toMatchObject({
      billingStatus: 'settled',
      chargedMicroPoints: 7,
      status: 'cancelled',
    })
  })

  it('enters reconcile_required and keeps the active reservation when settlement is uncertain', async () => {
    const base = createFakeRuntimeDependencies()
    const accountApi = {
      ...base.accountApi,
      getAccount: base.accountApi.getAccount.bind(base.accountApi),
      release: base.accountApi.release.bind(base.accountApi),
      reserve: base.accountApi.reserve.bind(base.accountApi),
      settle: async () => {
        throw new Error('Synthetic account-api timeout')
      },
    }
    const { dependencies, tasks, worker } = createServices({ ...base, accountApi })
    const task = await tasks.create(TASK_INPUT)

    await worker.runOnce()

    await expect(dependencies.tasks.get(task.id)).resolves.toMatchObject({
      billingStatus: 'reconcile_required',
      status: 'reconcile_required',
    })
    await expect(dependencies.accountApi.getAccount(TASK_INPUT.uid)).resolves.toMatchObject({
      activeTask: task.id,
      reservedMicroPoints: 40,
    })
    await expect(worker.runOnce()).resolves.toBe(false)
  })

  it('records known partial usage as pending when the model outcome is uncertain', async () => {
    const { dependencies, tasks, worker } = createServices({ modelExecutor: new UncertainExecutor() })
    const task = await tasks.create(TASK_INPUT)

    await worker.runOnce()

    await expect(dependencies.tasks.get(task.id)).resolves.toMatchObject({
      billingStatus: 'reconcile_required',
      errorCode: 'MODEL_EXECUTION_UNCERTAIN',
      status: 'reconcile_required',
    })
    await expect(dependencies.usage.listByTask(task.id)).resolves.toMatchObject([{
      billingResponsibility: 'pending',
      model: 'fake-model',
      outcome: 'error',
      providerGroup: 'cloudbase',
      providerRequestId: `uncertain-${task.id}-1`,
      usage: {
        cachedInputTokens: 1,
        inputTokens: 3,
        outputTokens: 2,
        reasoningTokens: 1,
      },
    }])
    await expect(dependencies.accountApi.getAccount(TASK_INPUT.uid)).resolves.toMatchObject({
      activeTask: task.id,
      reservedMicroPoints: 40,
    })
  })

  it('cancels a queued task by releasing both reservations', async () => {
    const { dependencies, tasks } = createServices()
    const task = await tasks.create(TASK_INPUT)

    await tasks.cancel(task.id)

    await expect(dependencies.tasks.get(task.id)).resolves.toMatchObject({
      billingStatus: 'released',
      status: 'cancelled',
    })
    const account = await dependencies.accountApi.getAccount(TASK_INPUT.uid)
    expect(account).toMatchObject({
      availableMicroPoints: 1_000_000,
    })
    expect(account).not.toHaveProperty('activeTask')
  })
})
