import type { ModelExecutionRequest, ModelExecutionResult, ModelExecutor } from './types.js'

export class FakeModelExecutor implements ModelExecutor {
  async execute(request: ModelExecutionRequest): Promise<ModelExecutionResult> {
    if (request.signal?.aborted)
      throw request.signal.reason

    await request.onTextDelta?.('# Synthetic')
    await request.onTextDelta?.(' outline\n')

    return {
      finishReason: 'stop',
      requestId: `fake-request-${request.taskId}-${request.attempt}`,
      streamText: '# Synthetic outline\n',
      usage: {
        cachedInputTokens: 0,
        inputTokens: 12,
        outputTokens: 8,
        reasoningTokens: 0,
      },
    }
  }
}
