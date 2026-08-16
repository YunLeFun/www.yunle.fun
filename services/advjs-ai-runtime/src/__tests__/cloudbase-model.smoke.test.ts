import process from 'node:process'
import { describe, expect, it } from 'vitest'
import { createCloudBaseModelExecutor } from '../executors/cloudbase-model.js'

const realSmokeEnabled = process.env.ADVJS_AI_REAL_MODEL_SMOKE === '1'
const describeRealModel = realSmokeEnabled ? describe : describe.skip

describeRealModel('cloudBase real model smoke', () => {
  it('streams text and returns non-zero provider usage', { timeout: 130_000 }, async () => {
    const env = process.env.ADVJS_AI_CLOUDBASE_ENV_ID?.trim()
    const model = process.env.ADVJS_AI_CLOUDBASE_MODEL?.trim()
    if (!env || !model)
      throw new Error('ADVJS_AI_CLOUDBASE_ENV_ID and ADVJS_AI_CLOUDBASE_MODEL are required for the real smoke test')

    const executor = createCloudBaseModelExecutor({ env })
    const result = await executor.execute({
      attempt: 1,
      capability: 'generate-outline',
      input: { smoke: true },
      model,
      prompt: {
        system: 'Return only a short plain-text acknowledgement.',
        user: 'Reply with OK.',
      },
      providerGroup: 'cloudbase',
      taskId: 'task_explicit_real_smoke',
      temperatureMilli: 0,
      timeoutMs: 120_000,
    })

    expect(result.streamText.length).toBeGreaterThan(0)
    expect(result.usage.inputTokens + result.usage.cachedInputTokens).toBeGreaterThan(0)
    expect(result.usage.outputTokens + result.usage.reasoningTokens).toBeGreaterThan(0)
  })
})
