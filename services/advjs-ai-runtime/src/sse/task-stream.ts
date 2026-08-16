import type { RuntimeRequest, RuntimeResponse } from '../api/types.js'
import type { AgentEventEnvelope, JsonValue } from '../contracts/v1.js'
import type { RuntimeDependencies } from '../dependencies.js'
import { AGENT_PROTOCOL_VERSION } from '../contracts/v1.js'
import { isTerminalTaskStatus } from '../domain/task.js'
import { formatTaskStreamCursor, projectTaskEvents } from './task-events.js'

export interface SseEvent {
  data: string
  event?: string
  id?: string
  retry?: number
}

export interface SseTransport {
  readonly closed: boolean
  send: (event: SseEvent) => boolean
  end: (event: SseEvent) => void
  on: (event: 'close', listener: () => void) => unknown
}

export interface RuntimeTaskStreamOptions {
  allowedOrigins: readonly string[]
  pollIntervalMs?: number
  heartbeatIntervalMs?: number
  sleep?: (milliseconds: number) => Promise<void>
}

export type TaskStreamPreparation
  = | { kind: 'response', response: RuntimeResponse }
    | {
      kind: 'stream'
      headers: Readonly<Record<string, string>>
      start: (transport: SseTransport) => Promise<void>
    }

function normalizeHeaders(headers: RuntimeRequest['headers']): Record<string, string> {
  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string' && value)
      normalized[key.toLowerCase()] = value
  }
  return normalized
}

function response(
  status: number,
  code: string,
  message: string,
  requestId: string,
  cors: Readonly<Record<string, string>> = {},
): TaskStreamPreparation {
  return {
    kind: 'response',
    response: {
      status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-request-id': requestId,
        ...cors,
      },
      body: {
        protocolVersion: AGENT_PROTOCOL_VERSION,
        error: { code, message, requestId, retryable: false },
      } as JsonValue,
    },
  }
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    'access-control-allow-credentials': 'true',
    'access-control-allow-origin': origin,
    'cache-control': 'no-cache, no-transform',
    'vary': 'Origin',
  }
}

function bearer(headers: Record<string, string>): string | undefined {
  return /^Bearer (\S+)$/.exec(headers.authorization ?? '')?.[1]
}

function sseEvent(envelope: AgentEventEnvelope): SseEvent {
  return {
    data: JSON.stringify(envelope),
    event: envelope.event.type,
    id: envelope.id,
  }
}

function terminalReplay(taskId: string, projected: ReturnType<typeof projectTaskEvents>): SseEvent {
  const terminal = projected.events.at(-1)
  if (!terminal)
    throw new Error(`Terminal task has no projected event: ${taskId}`)
  return sseEvent(terminal)
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

export function isTaskEventStreamRequest(request: RuntimeRequest): boolean {
  const path = new URL(request.path, 'https://runtime.invalid').pathname
  return request.method.toUpperCase() === 'GET' && /^\/v1\/tasks\/[\w.-]+\/events$/.test(path)
}

export function createTaskStreamPreparer(
  dependencies: RuntimeDependencies,
  options: RuntimeTaskStreamOptions,
) {
  const origins = new Set(options.allowedOrigins)
  const pollIntervalMs = options.pollIntervalMs ?? 500
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15_000
  const sleep = options.sleep ?? defaultSleep
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1)
    throw new TypeError('pollIntervalMs must be a positive safe integer')
  if (!Number.isSafeInteger(heartbeatIntervalMs) || heartbeatIntervalMs < pollIntervalMs)
    throw new TypeError('heartbeatIntervalMs must be at least pollIntervalMs')

  return async (request: RuntimeRequest): Promise<TaskStreamPreparation> => {
    const headers = normalizeHeaders(request.headers)
    const providedRequestId = headers['x-request-id']
    const requestId = providedRequestId && /^[\w.:-]{8,128}$/.test(providedRequestId)
      ? providedRequestId
      : dependencies.ids.generate('request')
    const url = new URL(request.path, 'https://runtime.invalid')
    const match = /^\/v1\/tasks\/([\w.-]+)\/events$/.exec(url.pathname)
    if (request.method.toUpperCase() !== 'GET' || !match?.[1])
      return response(404, 'ROUTE_NOT_FOUND', 'Route was not found', requestId)

    const origin = headers.origin ?? ''
    if (!origin || !origins.has(origin))
      return response(403, 'ORIGIN_FORBIDDEN', 'Request origin is not allowed', requestId)
    const cors = corsHeaders(origin)
    const accessToken = bearer(headers)
    if (!accessToken)
      return response(401, 'AUTH_REQUIRED', 'Authentication is required', requestId, cors)

    let uid: string
    try {
      uid = (await dependencies.auth.verifyAccessToken(accessToken)).uid
    }
    catch {
      return response(401, 'AUTH_REQUIRED', 'Authentication is required', requestId, cors)
    }
    const taskId = match[1]
    const initialTask = await dependencies.tasks.get(taskId)
    if (!initialTask || initialTask.uid !== uid)
      return response(404, 'TASK_NOT_FOUND', 'Task was not found', requestId, cors)

    let initialCursor: string | undefined
    const cursorValue = url.searchParams.get('cursor') ?? headers['last-event-id']
    const offsetValue = url.searchParams.get('offset')
    try {
      if (cursorValue) {
        projectTaskEvents(initialTask, [], cursorValue)
        initialCursor = cursorValue
      }
      else if (offsetValue !== null) {
        const offset = Number(offsetValue)
        if (!/^\d+$/.test(offsetValue) || !Number.isSafeInteger(offset))
          throw new TypeError('Offset is invalid')
        initialCursor = formatTaskStreamCursor({
          attempt: initialTask.attempt ?? 0,
          streamRevision: initialTask.streamRevision ?? 0,
          offset,
          taskVersion: initialTask.version ?? 0,
          phase: 0,
        })
      }
    }
    catch {
      return response(400, 'INVALID_CURSOR', 'Stream cursor is invalid', requestId, cors)
    }
    const fallbackCursor = formatTaskStreamCursor({
      attempt: initialTask.attempt ?? 0,
      streamRevision: initialTask.streamRevision ?? 0,
      offset: (initialTask.streamText ?? '').length,
      taskVersion: initialTask.version ?? 0,
      phase: 1,
    })

    return {
      kind: 'stream',
      headers: { ...cors, 'x-request-id': requestId },
      start: async (transport) => {
        let disconnected = transport.closed
        let cursor = initialCursor
        let idleMilliseconds = 0
        transport.on('close', () => disconnected = true)

        try {
          while (true) {
            if (disconnected || transport.closed)
              return
            const current = await dependencies.tasks.get(taskId)
            if (!current || current.uid !== uid)
              return
            const usage = current.billingStatus === 'settled' || isTerminalTaskStatus(current.status)
              ? await dependencies.usage.listByTask(taskId)
              : []
            const projected = projectTaskEvents(current, usage, cursor)
            cursor = projected.cursor
            const terminal = isTerminalTaskStatus(current.status)

            if (terminal) {
              const messages = projected.events.length > 0
                ? projected.events.map(sseEvent)
                : [terminalReplay(current.id, projectTaskEvents(current, usage))]
              for (const message of messages.slice(0, -1)) {
                if (disconnected || transport.closed)
                  return
                transport.send(message)
              }
              if (disconnected || transport.closed)
                return
              transport.end(messages.at(-1)!)
              return
            }

            if (projected.events.length > 0) {
              for (const event of projected.events) {
                if (disconnected || transport.closed)
                  return
                transport.send(sseEvent(event))
              }
              idleMilliseconds = 0
            }
            else {
              idleMilliseconds += pollIntervalMs
              if (idleMilliseconds >= heartbeatIntervalMs) {
                const heartbeat: AgentEventEnvelope = {
                  protocolVersion: AGENT_PROTOCOL_VERSION,
                  id: `${taskId}:${cursor}`,
                  cursor,
                  event: { type: 'heartbeat', at: dependencies.clock.now() },
                }
                transport.send(sseEvent(heartbeat))
                idleMilliseconds = 0
              }
            }
            await sleep(pollIntervalMs)
          }
        }
        catch {
          if (disconnected || transport.closed)
            return
          const failureCursor = cursor ?? fallbackCursor
          transport.end(sseEvent({
            protocolVersion: AGENT_PROTOCOL_VERSION,
            id: `${taskId}:${failureCursor}:stream-error`,
            cursor: failureCursor,
            event: {
              type: 'run.failed',
              taskId,
              error: {
                code: 'internal_error',
                message: 'The task stream was interrupted.',
                retryable: true,
                requestId,
              },
            },
          }))
        }
      },
    }
  }
}
