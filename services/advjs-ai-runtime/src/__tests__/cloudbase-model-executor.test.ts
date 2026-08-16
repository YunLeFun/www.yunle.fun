import type {
  CloudBaseAiClient,
  CloudBaseStreamTextInput,
  CloudBaseStreamTextResult,
} from '../executors/cloudbase-model.js'
import type { ModelExecutionRequest } from '../executors/types.js'
import { describe, expect, it } from 'vitest'
import { CloudBaseModelExecutor } from '../executors/cloudbase-model.js'
import { ModelExecutionError, ModelExecutionUncertainError } from '../executors/errors.js'

async function* values<T>(items: readonly T[]): AsyncGenerator<T> {
  for (const item of items)
    yield item
}

function request(overrides: Partial<ModelExecutionRequest> = {}): ModelExecutionRequest {
  return {
    attempt: 1,
    capability: 'generate-outline',
    input: { premise: 'client semantic input is not sent to the SDK directly' },
    model: 'deepseek-v4-flash',
    prompt: {
      system: 'Server-owned system instruction',
      user: 'Server-normalized user instruction',
    },
    providerGroup: 'cloudbase',
    taskId: 'task_fixture_001',
    temperatureMilli: 700,
    timeoutMs: 60_000,
    ...overrides,
  }
}

function client(
  stream: (input: CloudBaseStreamTextInput, options: { timeout: number }) => Promise<CloudBaseStreamTextResult>,
  onGroup?: (group: 'cloudbase') => void,
): CloudBaseAiClient {
  return {
    createModel(group) {
      onGroup?.(group)
      return { streamText: stream }
    },
  }
}

describe('cloudBase model executor', () => {
  it('uses the managed group and streams only the server-selected model and prompt', async () => {
    const groups: string[] = []
    const deltas: string[] = []
    let receivedInput: CloudBaseStreamTextInput | undefined
    let receivedTimeout = 0
    const executor = new CloudBaseModelExecutor(client(async (input, options) => {
      receivedInput = input
      receivedTimeout = options.timeout
      input.onStepFinish({ finishReason: 'stop' })
      return {
        dataStream: values([{ rawResponse: {
          id: 'provider-request-001',
          usage: {
            completion_tokens_details: { reasoning_tokens: 2 },
            prompt_cache_hit_tokens: 3,
          },
        } }]),
        textStream: values(['# 第一幕', '\n- 转折']),
        usage: Promise.resolve({ completion_tokens: 8, prompt_tokens: 12, total_tokens: 20 }),
      }
    }, group => groups.push(group)))

    const result = await executor.execute(request({
      onTextDelta: async delta => void deltas.push(delta),
    }))

    expect(groups).toEqual(['cloudbase'])
    expect(receivedInput).toMatchObject({
      model: 'deepseek-v4-flash',
      messages: [
        { role: 'system', content: 'Server-owned system instruction' },
        { role: 'user', content: 'Server-normalized user instruction' },
      ],
      temperature: 0.7,
    })
    expect(receivedInput).not.toHaveProperty('input')
    expect(receivedTimeout).toBe(60_000)
    expect(deltas).toEqual(['# 第一幕', '\n- 转折'])
    expect(result).toEqual({
      finishReason: 'stop',
      requestId: 'provider-request-001',
      streamText: '# 第一幕\n- 转折',
      usage: {
        cachedInputTokens: 3,
        inputTokens: 9,
        outputTokens: 6,
        reasoningTokens: 2,
      },
    })
  })

  it('maps a provider length finish reason without guessing a successful stop', async () => {
    const executor = new CloudBaseModelExecutor(client(async (input) => {
      input.onStepFinish({ finishReason: 'length' })
      return {
        dataStream: values([]),
        textStream: values(['partial']),
        usage: Promise.resolve({ completion_tokens: 4, prompt_tokens: 3, total_tokens: 7 }),
      }
    }))

    await expect(executor.execute(request())).resolves.toMatchObject({ finishReason: 'length' })
  })

  it('rejects invalid policy before creating a billable model request', async () => {
    let calls = 0
    const executor = new CloudBaseModelExecutor(client(async () => {
      calls += 1
      throw new Error('must not dispatch')
    }))

    await expect(executor.execute(request({ model: '' }))).rejects.toBeInstanceOf(ModelExecutionError)
    expect(calls).toBe(0)
  })

  it('marks missing usage as uncertain instead of silently charging zero', async () => {
    const executor = new CloudBaseModelExecutor(client(async () => ({
      dataStream: values([{ id: 'provider-request-usage-missing' }]),
      textStream: values(['generated text']),
      usage: Promise.resolve({ completion_tokens: 0, prompt_tokens: 0, total_tokens: 0 }),
    })))

    await expect(executor.execute(request())).rejects.toMatchObject({
      message: expect.stringMatching(/usage.*missing/i),
      name: 'Error',
    })
  })

  it('marks stream interruption and abort races as uncertain', async () => {
    async function* interrupted(): AsyncGenerator<string> {
      yield 'partial'
      throw new Error('synthetic transport reset')
    }
    const executor = new CloudBaseModelExecutor(client(async () => ({
      dataStream: values([{ id: 'provider-request-interrupted' }]),
      textStream: interrupted(),
      usage: Promise.resolve({ completion_tokens: 2, prompt_tokens: 3, total_tokens: 5 }),
    })))

    await expect(executor.execute(request())).rejects.toBeInstanceOf(ModelExecutionUncertainError)

    const abortController = new AbortController()
    abortController.abort(new Error('cancelled'))
    await expect(executor.execute(request({ signal: abortController.signal }))).rejects.toBeInstanceOf(ModelExecutionError)
  })
})
