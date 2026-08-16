import type { JsonValue } from '../contracts/v1.js'
import type { RuntimeDependencies } from '../dependencies.js'
import type { RuntimeTaskRecord, RuntimeUsageRecord } from '../domain/task.js'

export const READ_PROJECTION_AUDIENCE = 'advjs-ai-runtime-read-projection'
export const READ_PROJECTION_PREFIX = '/internal/v1/read-projection/'
export const READ_PROJECTION_USER_AUTHORIZATION_HEADER = 'x-yunlefun-user-authorization'

interface ReadProjectionUsageV1 {
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  reasoningTokens: number
  totalTokens: number
  providerCostMicroCny: number
  chargedMicroPoints: number
}

interface ReadProjectionTaskV1 {
  schemaVersion: 1
  id: string
  status: RuntimeTaskRecord['status']
  appId?: string
  clientRequestId?: string
  requestHash?: string
  capability?: RuntimeTaskRecord['capability']
  input?: JsonValue
  projectId?: string
  projectRevision?: string
  proposal?: RuntimeTaskRecord['proposal']
  billingStatus?: RuntimeTaskRecord['billingStatus']
  reservedMicroPoints?: number
  chargedMicroPoints?: number
  streamText?: string
  streamRevision?: number
  attempt?: number
  createdAt?: number
  updatedAt?: number
  completedAt?: number
  expiresAt?: number
  version?: number
  errorCode?: string
}

export interface ReadProjectionEnvelopeV1 {
  schemaVersion: 1
  task: ReadProjectionTaskV1
  usage?: ReadProjectionUsageV1
}

function addSafe(left: number, right: number, field: string): number {
  const result = left + right
  if (!Number.isSafeInteger(result) || result < 0)
    throw new RangeError(`${field} exceeds the safe integer range`)
  return result
}

function aggregateUsage(
  task: RuntimeTaskRecord,
  records: readonly RuntimeUsageRecord[],
): ReadProjectionUsageV1 | undefined {
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

function projectTask(task: RuntimeTaskRecord): ReadProjectionTaskV1 {
  return {
    schemaVersion: 1,
    id: task.id,
    status: task.status,
    ...(task.appId === undefined ? {} : { appId: task.appId }),
    ...(task.clientRequestId === undefined ? {} : { clientRequestId: task.clientRequestId }),
    ...(task.requestHash === undefined ? {} : { requestHash: task.requestHash }),
    ...(task.capability === undefined ? {} : { capability: task.capability }),
    ...(task.input === undefined ? {} : { input: structuredClone(task.input) }),
    ...(task.projectId === undefined ? {} : { projectId: task.projectId }),
    ...(task.projectRevision === undefined ? {} : { projectRevision: task.projectRevision }),
    ...(task.proposal === undefined ? {} : { proposal: structuredClone(task.proposal) }),
    ...(task.billingStatus === undefined ? {} : { billingStatus: task.billingStatus }),
    ...(task.reservedMicroPoints === undefined ? {} : { reservedMicroPoints: task.reservedMicroPoints }),
    ...(task.chargedMicroPoints === undefined ? {} : { chargedMicroPoints: task.chargedMicroPoints }),
    ...(task.streamText === undefined ? {} : { streamText: task.streamText }),
    ...(task.streamRevision === undefined ? {} : { streamRevision: task.streamRevision }),
    ...(task.attempt === undefined ? {} : { attempt: task.attempt }),
    ...(task.createdAt === undefined ? {} : { createdAt: task.createdAt }),
    ...(task.updatedAt === undefined ? {} : { updatedAt: task.updatedAt }),
    ...(task.completedAt === undefined ? {} : { completedAt: task.completedAt }),
    ...(task.expiresAt === undefined ? {} : { expiresAt: task.expiresAt }),
    ...(task.version === undefined ? {} : { version: task.version }),
    ...(task.errorCode === undefined ? {} : { errorCode: task.errorCode }),
  }
}

export async function readTaskProjection(
  dependencies: RuntimeDependencies,
  taskId: string,
  uid: string,
): Promise<ReadProjectionEnvelopeV1 | undefined> {
  const task = await dependencies.tasks.get(taskId)
  if (!task || task.uid !== uid)
    return undefined
  const usage = aggregateUsage(task, await dependencies.usage.listByTask(task.id))
  return {
    schemaVersion: 1,
    task: projectTask(task),
    ...(usage ? { usage } : {}),
  }
}
