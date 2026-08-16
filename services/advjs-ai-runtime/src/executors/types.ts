import type { AgentCapabilityId, JsonValue } from '../contracts/v1.js'

export interface ModelExecutionRequest {
  taskId: string
  attempt: number
  capability: AgentCapabilityId
  input: JsonValue
  providerGroup: 'cloudbase'
  model: string
  prompt: {
    system: string
    user: string
  }
  temperatureMilli: number
  timeoutMs: number
  signal?: AbortSignal
  onTextDelta?: (delta: string) => Promise<void>
}

export interface ModelUsage {
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  reasoningTokens: number
}

export interface ModelExecutionResult {
  requestId?: string
  streamText: string
  finishReason: 'stop' | 'length' | 'blocked'
  usage: ModelUsage
}

export interface ModelExecutor {
  execute: (request: ModelExecutionRequest) => Promise<ModelExecutionResult>
}

export interface AgentExecutor extends ModelExecutor {}
