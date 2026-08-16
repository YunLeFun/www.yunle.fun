import type { ICloudBaseConfig } from '@cloudbase/node-sdk'
import type { ModelExecutionRequest, ModelExecutionResult, ModelExecutor, ModelUsage } from './types.js'
import cloudbase from '@cloudbase/node-sdk'
import { ModelExecutionError, ModelExecutionUncertainError } from './errors.js'

export interface CloudBaseStreamStep {
  finishReason?: string
}

export interface CloudBaseStreamTextInput {
  model: string
  messages: [
    { role: 'system', content: string },
    { role: 'user', content: string },
  ]
  temperature: number
  abortSignal?: AbortSignal
  onStepFinish: (step: CloudBaseStreamStep) => void
}

export interface CloudBaseSdkUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export interface CloudBaseStreamTextResult {
  textStream: AsyncIterable<string>
  dataStream: AsyncIterable<unknown>
  usage: Promise<CloudBaseSdkUsage>
  error?: unknown
}

export interface CloudBaseTextModel {
  streamText: (
    input: CloudBaseStreamTextInput,
    options: { timeout: number },
  ) => Promise<CloudBaseStreamTextResult>
}

export interface CloudBaseAiClient {
  createModel: (group: 'cloudbase') => CloudBaseTextModel
}

export type CloudBaseModelExecutorConfig = ICloudBaseConfig & { env: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function optionalIdentifier(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : undefined
}

function providerRequestId(chunk: unknown): string | undefined {
  if (!isRecord(chunk))
    return undefined
  const direct = optionalIdentifier(chunk.requestId)
    ?? optionalIdentifier(chunk.request_id)
    ?? optionalIdentifier(chunk.id)
  if (direct)
    return direct
  return isRecord(chunk.rawResponse) ? providerRequestId(chunk.rawResponse) : undefined
}

function optionalTokenCount(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined
}

interface StreamMetadata {
  requestId?: string
  cachedInputTokens?: number
  reasoningTokens?: number
}

function usageMetadata(chunk: unknown): Omit<StreamMetadata, 'requestId'> {
  if (!isRecord(chunk))
    return {}
  if (isRecord(chunk.rawResponse)) {
    const nested = usageMetadata(chunk.rawResponse)
    if (nested.cachedInputTokens !== undefined || nested.reasoningTokens !== undefined)
      return nested
  }
  if (!isRecord(chunk.usage))
    return {}

  const promptDetails = isRecord(chunk.usage.prompt_tokens_details)
    ? chunk.usage.prompt_tokens_details
    : undefined
  const completionDetails = isRecord(chunk.usage.completion_tokens_details)
    ? chunk.usage.completion_tokens_details
    : undefined
  const cachedInputTokens = optionalTokenCount(chunk.usage.prompt_cache_hit_tokens)
    ?? optionalTokenCount(promptDetails?.cached_tokens)
  const reasoningTokens = optionalTokenCount(completionDetails?.reasoning_tokens)
  return {
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
  }
}

function assertUsage(value: CloudBaseSdkUsage, metadata: StreamMetadata): ModelUsage {
  const buckets = [value.prompt_tokens, value.completion_tokens, value.total_tokens]
  if (buckets.some(bucket => !Number.isSafeInteger(bucket) || bucket < 0))
    throw new ModelExecutionUncertainError('CloudBase returned invalid model usage')
  if (value.total_tokens === 0 || value.total_tokens < value.prompt_tokens + value.completion_tokens)
    throw new ModelExecutionUncertainError('CloudBase model usage is missing or incomplete')
  const cachedInputTokens = metadata.cachedInputTokens ?? 0
  const reasoningTokens = metadata.reasoningTokens ?? 0
  if (cachedInputTokens > value.prompt_tokens || reasoningTokens > value.completion_tokens)
    throw new ModelExecutionUncertainError('CloudBase model usage details are inconsistent')
  return {
    inputTokens: value.prompt_tokens - cachedInputTokens,
    outputTokens: value.completion_tokens - reasoningTokens,
    cachedInputTokens,
    reasoningTokens,
  }
}

function finishReason(value: string | undefined): ModelExecutionResult['finishReason'] {
  if (value === 'length')
    return 'length'
  if (value === 'blocked' || value === 'content_filter')
    return 'blocked'
  return 'stop'
}

async function collectMetadata(
  stream: AsyncIterable<unknown>,
  onMetadata: (metadata: StreamMetadata) => void,
): Promise<StreamMetadata> {
  const metadata: StreamMetadata = {}
  for await (const chunk of stream) {
    const requestId = providerRequestId(chunk)
    if (!metadata.requestId && requestId)
      metadata.requestId = requestId
    const usage = usageMetadata(chunk)
    if (usage.cachedInputTokens !== undefined)
      metadata.cachedInputTokens = usage.cachedInputTokens
    if (usage.reasoningTokens !== undefined)
      metadata.reasoningTokens = usage.reasoningTokens
    onMetadata(metadata)
  }
  return metadata
}

async function collectText(
  stream: AsyncIterable<string>,
  onTextDelta: ModelExecutionRequest['onTextDelta'],
): Promise<string> {
  let output = ''
  for await (const delta of stream) {
    if (typeof delta !== 'string')
      throw new ModelExecutionUncertainError('CloudBase returned an invalid text stream chunk')
    output += delta
    await onTextDelta?.(delta)
  }
  return output
}

export class CloudBaseModelExecutor implements ModelExecutor {
  constructor(private readonly client: CloudBaseAiClient) {}

  async execute(request: ModelExecutionRequest): Promise<ModelExecutionResult> {
    if (request.providerGroup !== 'cloudbase')
      throw new ModelExecutionError('CloudBase executor only accepts the cloudbase provider group', { retryable: false })
    if (request.signal?.aborted)
      throw new ModelExecutionError('Model execution was aborted before dispatch', { retryable: false })
    if (!request.model || !request.prompt.system || !request.prompt.user)
      throw new ModelExecutionError('Server model policy and prompt are required', { retryable: false })
    if (!Number.isSafeInteger(request.temperatureMilli) || request.temperatureMilli < 0 || request.temperatureMilli > 2_000)
      throw new ModelExecutionError('Server model temperature is invalid', { retryable: false })
    if (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs <= 0)
      throw new ModelExecutionError('Server model timeout is invalid', { retryable: false })

    let observedFinishReason: string | undefined
    let observedRequestId: string | undefined
    let observedUsage: ModelUsage | undefined
    try {
      const model = this.client.createModel('cloudbase')
      const result = await model.streamText({
        model: request.model,
        messages: [
          { role: 'system', content: request.prompt.system },
          { role: 'user', content: request.prompt.user },
        ],
        temperature: request.temperatureMilli / 1_000,
        onStepFinish: step => observedFinishReason = step.finishReason,
        ...(request.signal ? { abortSignal: request.signal } : {}),
      }, { timeout: request.timeoutMs })

      const metadataPromise = collectMetadata(result.dataStream, (metadata) => {
        if (metadata.requestId)
          observedRequestId = metadata.requestId
      })
      const [streamText, metadata] = await Promise.all([
        collectText(result.textStream, request.onTextDelta),
        metadataPromise,
      ])
      const sdkUsage = await result.usage
      observedUsage = assertUsage(sdkUsage, metadata)
      if (result.error !== undefined)
        throw new ModelExecutionUncertainError('CloudBase reported a streaming model error')

      return {
        finishReason: finishReason(observedFinishReason),
        streamText,
        usage: observedUsage,
        ...(observedRequestId ? { requestId: observedRequestId } : {}),
      }
    }
    catch (error) {
      if (error instanceof ModelExecutionError)
        throw error
      if (error instanceof ModelExecutionUncertainError) {
        const requestId = error.requestId ?? observedRequestId
        const usage = error.usage ?? observedUsage
        throw new ModelExecutionUncertainError(error.message, {
          ...(requestId ? { requestId } : {}),
          ...(usage ? { usage } : {}),
        })
      }
      throw new ModelExecutionUncertainError('CloudBase model execution outcome is uncertain', {
        ...(observedRequestId ? { requestId: observedRequestId } : {}),
        ...(observedUsage ? { usage: observedUsage } : {}),
      })
    }
  }
}

export function createCloudBaseModelExecutor(config: CloudBaseModelExecutorConfig): CloudBaseModelExecutor {
  if (!config.env.trim())
    throw new TypeError('Canonical CloudBase environment ID is required')
  const ai = cloudbase.init(config).ai()
  const client: CloudBaseAiClient = {
    createModel(group) {
      const model = ai.createModel(group)
      return {
        async streamText(input, options) {
          return model.streamText(input, options)
        },
      }
    },
  }
  return new CloudBaseModelExecutor(client)
}
