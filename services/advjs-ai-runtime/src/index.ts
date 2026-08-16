import type { RuntimeApiOptions } from './api/runtime-api.js'
import type { RuntimeRequest, RuntimeResponse } from './api/types.js'
import type { RuntimeDependencies } from './dependencies.js'
import type { RuntimeBackgroundLoop } from './production/lifecycle.js'
import type { SseTransport } from './sse/task-stream.js'
import process from 'node:process'
import { createRuntimeApiHandler } from './api/runtime-api.js'
import { createProductionRuntime } from './production/composition.js'
import { loadProductionRuntimeConfig } from './production/config.js'
import { createTaskStreamPreparer, isTaskEventStreamRequest } from './sse/task-stream.js'
import { createFakeRuntimeDependencies } from './testing/fakes.js'

interface CloudRunHttpContext {
  headers?: Readonly<Record<string, string | readonly string[] | undefined>>
  httpMethod?: string
  url?: string
}

export interface CloudRunFunctionContext {
  httpContext?: CloudRunHttpContext
  sse?: (options?: {
    keepalive?: boolean
    headers?: Readonly<Record<string, string>>
  }) => SseTransport | null
}

export interface CloudRunIntegratedResponse {
  statusCode: number
  headers: Readonly<Record<string, string>>
  body: RuntimeResponse['body']
}

const localFakeMode = process.env.ADVJS_AI_RUNTIME_MODE === 'local-fake'
const allowedOrigins = localFakeMode
  ? (process.env.ADVJS_AI_ALLOWED_ORIGINS ?? 'http://localhost:3000,http://localhost:5173')
      .split(',')
      .map(origin => origin.trim())
      .filter(Boolean)
  : []
function requestPath(url: string | undefined): string {
  if (!url)
    return '/health'
  try {
    const parsed = new URL(url, 'http://localhost')
    return `${parsed.pathname}${parsed.search}`
  }
  catch {
    return '/health'
  }
}

function requestHeaders(
  headers: CloudRunHttpContext['headers'],
): Record<string, string | undefined> {
  const normalized: Record<string, string | undefined> = {}
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (typeof value === 'string' || value === undefined)
      normalized[key] = value
    else
      normalized[key] = value[0]
  }
  return normalized
}

export function mapCloudRunRequest(
  event: unknown,
  context: CloudRunFunctionContext = {},
): RuntimeRequest {
  const method = context.httpContext?.httpMethod ?? 'GET'
  const hasBody = method !== 'GET' && method !== 'HEAD'
  return {
    method,
    path: requestPath(context.httpContext?.url),
    headers: requestHeaders(context.httpContext?.headers),
    ...(hasBody ? { body: event } : {}),
  }
}

export function toCloudRunResponse(response: RuntimeResponse): CloudRunIntegratedResponse {
  return {
    statusCode: response.status,
    headers: response.headers,
    body: response.body,
  }
}

export interface CloudRunMainOptions extends RuntimeApiOptions {}

export function createCloudRunMain(
  dependencies: RuntimeDependencies,
  options: CloudRunMainOptions,
) {
  const handle = createRuntimeApiHandler(dependencies, options)
  const prepareTaskStream = createTaskStreamPreparer(dependencies, {
    allowedOrigins: options.allowedOrigins,
  })

  return async (event: unknown = {}, context: CloudRunFunctionContext = {}) => {
    const request = mapCloudRunRequest(event, context)
    if (!isTaskEventStreamRequest(request))
      return toCloudRunResponse(await handle(request))

    const prepared = await prepareTaskStream(request)
    if (prepared.kind === 'response')
      return toCloudRunResponse(prepared.response)
    const stream = context.sse?.({
      keepalive: false,
      headers: prepared.headers,
    })
    if (!stream) {
      return toCloudRunResponse({
        status: 500,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: {
          protocolVersion: 1,
          error: {
            code: 'SSE_UNAVAILABLE',
            message: 'Streaming is unavailable',
            retryable: true,
          },
        },
      })
    }
    void prepared.start(stream)
    return ''
  }
}

type CloudRunMain = ReturnType<typeof createCloudRunMain>

let mainHandler: CloudRunMain | undefined
let background: RuntimeBackgroundLoop | undefined
let shutdownRegistered = false

function registerShutdown(loop: RuntimeBackgroundLoop): void {
  if (shutdownRegistered)
    return
  shutdownRegistered = true
  for (const signal of ['SIGTERM', 'SIGINT'] as const)
    process.once(signal, () => loop.stop())
}

function defaultMainHandler(): CloudRunMain {
  if (mainHandler)
    return mainHandler
  if (localFakeMode) {
    mainHandler = createCloudRunMain(createFakeRuntimeDependencies(), {
      appId: 'advjs-studio-web',
      allowedOrigins,
    })
    return mainHandler
  }

  const production = createProductionRuntime(loadProductionRuntimeConfig(process.env))
  background = production.background
  background.start()
  registerShutdown(background)
  mainHandler = createCloudRunMain(production.dependencies, production.apiOptions)
  return mainHandler
}

export async function main(event: unknown = {}, context: CloudRunFunctionContext = {}) {
  return defaultMainHandler()(event, context)
}

export { createRuntimeHandler } from './api/handler.js'
export { createRuntimeApiHandler } from './api/runtime-api.js'
export type { RuntimeDependencies } from './dependencies.js'
export { CloudBaseModelExecutor, createCloudBaseModelExecutor } from './executors/cloudbase-model.js'
