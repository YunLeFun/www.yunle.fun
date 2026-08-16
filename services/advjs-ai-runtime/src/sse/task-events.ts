import type {
  AgentError,
  AgentEvent,
  AgentEventEnvelope,
  AgentTaskSnapshot,
  AgentUsageSummary,
} from '../contracts/v1.js'
import type { RuntimeTaskRecord, RuntimeUsageRecord } from '../domain/task.js'
import { AGENT_PROTOCOL_VERSION } from '../contracts/v1.js'
import { isTerminalTaskStatus } from '../domain/task.js'

const CURSOR_PATTERN = /^v1:(\d+):(\d+):(\d+):(\d+):([0-4])$/

export interface TaskStreamCursor {
  attempt: number
  streamRevision: number
  offset: number
  taskVersion: number
  phase: 0 | 1 | 2 | 3 | 4
}

export interface TaskEventProjection {
  cursor: string
  events: AgentEventEnvelope[]
}

function safeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new TypeError(`${field} must be a non-negative safe integer`)
  return value
}

function addSafe(left: number, right: number, field: string): number {
  const result = left + right
  if (!Number.isSafeInteger(result))
    throw new RangeError(`${field} exceeds the safe integer range`)
  return result
}

export function formatTaskStreamCursor(cursor: TaskStreamCursor): string {
  return [
    'v1',
    safeInteger(cursor.attempt, 'attempt'),
    safeInteger(cursor.streamRevision, 'streamRevision'),
    safeInteger(cursor.offset, 'offset'),
    safeInteger(cursor.taskVersion, 'taskVersion'),
    cursor.phase,
  ].join(':')
}

export function parseTaskStreamCursor(value: string): TaskStreamCursor {
  const match = CURSOR_PATTERN.exec(value)
  if (!match)
    throw new TypeError('Task stream cursor is invalid')
  const values = match.slice(1).map(Number)
  if (values.some(item => !Number.isSafeInteger(item)))
    throw new TypeError('Task stream cursor is invalid')
  return {
    attempt: values[0]!,
    streamRevision: values[1]!,
    offset: values[2]!,
    taskVersion: values[3]!,
    phase: values[4] as TaskStreamCursor['phase'],
  }
}

function isCodePointBoundary(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length)
    return true
  const current = text.charCodeAt(offset)
  const previous = text.charCodeAt(offset - 1)
  return !(current >= 0xDC00 && current <= 0xDFFF && previous >= 0xD800 && previous <= 0xDBFF)
}

function projectMetadata(task: RuntimeTaskRecord): { id: string, revision: string } {
  if (task.projectId && task.projectRevision)
    return { id: task.projectId, revision: task.projectRevision }
  const input = task.input
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const project = input.project
    if (project && typeof project === 'object' && !Array.isArray(project)) {
      const id = project.id
      const revision = project.revision
      if (typeof id === 'string' && id && typeof revision === 'string' && revision)
        return { id, revision }
    }
  }
  return { id: 'project_unavailable', revision: 'revision_unavailable' }
}

function summarizeUsage(task: RuntimeTaskRecord, records: readonly RuntimeUsageRecord[]): AgentUsageSummary | undefined {
  if (records.length === 0)
    return undefined
  let inputTokens = 0
  let outputTokens = 0
  let cachedInputTokens = 0
  let reasoningTokens = 0
  let providerCostMicroCny = 0
  for (const record of records) {
    inputTokens = addSafe(inputTokens, record.usage?.inputTokens ?? 0, 'inputTokens')
    outputTokens = addSafe(outputTokens, record.usage?.outputTokens ?? 0, 'outputTokens')
    cachedInputTokens = addSafe(cachedInputTokens, record.usage?.cachedInputTokens ?? 0, 'cachedInputTokens')
    reasoningTokens = addSafe(reasoningTokens, record.usage?.reasoningTokens ?? 0, 'reasoningTokens')
    providerCostMicroCny = addSafe(providerCostMicroCny, record.providerCostMicroCny, 'providerCostMicroCny')
  }
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    reasoningTokens,
    totalTokens: addSafe(
      addSafe(inputTokens, outputTokens, 'totalTokens'),
      addSafe(cachedInputTokens, reasoningTokens, 'totalTokens'),
      'totalTokens',
    ),
    providerCostMicroCny,
    chargedMicroPoints: task.chargedMicroPoints ?? 0,
  }
}

function publicError(task: RuntimeTaskRecord): AgentError | undefined {
  if (task.status === 'completed')
    return undefined
  if (!isTerminalTaskStatus(task.status))
    return undefined
  if (task.status === 'cancelled') {
    return { code: 'cancelled', message: 'The generation was cancelled.', retryable: false }
  }
  if (task.status === 'blocked') {
    return { code: 'content_blocked', message: 'The generated candidate could not be delivered.', retryable: false }
  }
  if (task.status === 'reconcile_required') {
    return { code: 'reconcile_required', message: 'The task is awaiting account reconciliation.', retryable: false }
  }
  return {
    code: task.errorCode === 'EMPTY_CANDIDATE' ? 'parse_error' : 'upstream_error',
    message: 'The generation did not complete.',
    retryable: false,
  }
}

export function taskSnapshot(
  task: RuntimeTaskRecord,
  records: readonly RuntimeUsageRecord[],
): AgentTaskSnapshot {
  if (!task.capability)
    throw new TypeError('Task capability is missing')
  const project = projectMetadata(task)
  const usage = summarizeUsage(task, records)
  const error = publicError(task)
  return {
    protocolVersion: AGENT_PROTOCOL_VERSION,
    taskId: task.id,
    capability: task.capability,
    status: task.status,
    billingStatus: task.billingStatus ?? 'none',
    projectId: project.id,
    projectRevision: project.revision,
    streamText: task.streamText ?? '',
    streamRevision: task.streamRevision ?? 0,
    reservedMicroPoints: task.reservedMicroPoints ?? 0,
    ...(task.proposal ? { proposal: task.proposal } : {}),
    ...(usage ? { usage } : {}),
    points: {
      reservedMicroPoints: task.billingStatus === 'reserved' ? (task.reservedMicroPoints ?? 0) : 0,
      chargedMicroPoints: task.chargedMicroPoints ?? 0,
    },
    ...(error ? { error } : {}),
    createdAt: task.createdAt ?? 0,
    updatedAt: task.updatedAt ?? 0,
  }
}

function envelope(taskId: string, cursor: TaskStreamCursor, event: AgentEvent): AgentEventEnvelope {
  const encoded = formatTaskStreamCursor(cursor)
  return {
    protocolVersion: AGENT_PROTOCOL_VERSION,
    id: `${taskId}:${encoded}`,
    cursor: encoded,
    event,
  }
}

export function projectTaskEvents(
  task: RuntimeTaskRecord,
  records: readonly RuntimeUsageRecord[],
  cursorValue?: string,
): TaskEventProjection {
  const streamText = task.streamText ?? ''
  const current = {
    attempt: task.attempt ?? 0,
    streamRevision: task.streamRevision ?? 0,
    offset: streamText.length,
    taskVersion: task.version ?? 0,
  }
  let cursor = cursorValue ? parseTaskStreamCursor(cursorValue) : undefined
  const events: AgentEventEnvelope[] = []
  const staleStream = !cursor
    || cursor.attempt !== current.attempt
    || cursor.streamRevision > current.streamRevision
    || cursor.offset > current.offset
    || !isCodePointBoundary(streamText, cursor.offset)

  if (!staleStream && cursor && cursor.offset < current.offset) {
    const next: TaskStreamCursor = {
      ...current,
      taskVersion: cursor.taskVersion,
      phase: 0,
    }
    events.push(envelope(task.id, next, {
      type: 'text.delta',
      taskId: task.id,
      delta: streamText.slice(cursor.offset),
      offset: cursor.offset,
    }))
    cursor = next
  }

  if (staleStream
    || !cursor
    || cursor.taskVersion !== current.taskVersion
    || cursor.streamRevision !== current.streamRevision
    || cursor.phase === 0) {
    const next: TaskStreamCursor = { ...current, phase: 1 }
    events.push(envelope(task.id, next, { type: 'state.snapshot', task: taskSnapshot(task, records) }))
    cursor = next
  }

  if (task.proposal && cursor.phase < 2) {
    const next: TaskStreamCursor = { ...current, phase: 2 }
    events.push(envelope(task.id, next, { type: 'proposal.ready', taskId: task.id, proposal: task.proposal }))
    cursor = next
  }

  const usage = summarizeUsage(task, records)
  if (task.billingStatus === 'settled' && usage && cursor.phase < 3) {
    const next: TaskStreamCursor = { ...current, phase: 3 }
    events.push(envelope(task.id, next, { type: 'usage.settled', taskId: task.id, usage }))
    cursor = next
  }

  if (isTerminalTaskStatus(task.status) && cursor.phase < 4) {
    const next: TaskStreamCursor = { ...current, phase: 4 }
    const error = publicError(task)
    events.push(envelope(task.id, next, error
      ? { type: 'run.failed', taskId: task.id, error }
      : { type: 'run.finished', taskId: task.id }))
    cursor = next
  }

  return {
    cursor: formatTaskStreamCursor(cursor),
    events,
  }
}
