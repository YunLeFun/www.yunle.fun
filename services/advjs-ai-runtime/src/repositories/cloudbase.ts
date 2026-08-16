import type { CloudBase } from '@cloudbase/node-sdk'
import type { DailyBudgetDocument, RuntimePolicyDocument } from '../domain/budget.js'
import type { RuntimeTaskRecord, RuntimeUsageRecord } from '../domain/task.js'
import type {
  ClaimTaskInput,
  RenewTaskLeaseInput,
  RuntimeControlRepository,
  TaskRepository,
  UsageRepository,
} from './types.js'
import { createHash } from 'node:crypto'
import { isTaskContentExpired, patchTask, transitionTask } from '../domain/task.js'
import { ProviderRequestConflictError } from './types.js'

const TASKS_COLLECTION = 'ai_tasks'
const USAGE_COLLECTION = 'ai_usage_records'
const CONTROL_COLLECTION = 'ai_runtime_control'
const PAGE_SIZE = 100

type CloudBaseSdkDatabase = ReturnType<CloudBase['database']>
type CloudBaseSdkCollection = ReturnType<CloudBaseSdkDatabase['collection']>
type CloudBaseSdkDocumentReference = ReturnType<CloudBaseSdkCollection['doc']>
type CloudBaseSetInput = Parameters<CloudBaseSdkDocumentReference['set']>[0]

export interface CloudBaseQueryResult {
  data?: unknown[]
}

export interface CloudBaseDocumentResult {
  data?: unknown[] | Record<string, unknown>
}

export interface CloudBaseQuery {
  where: (conditions: Record<string, unknown>) => CloudBaseQuery
  orderBy: (field: string, direction: 'asc' | 'desc') => CloudBaseQuery
  limit: (maximum: number) => CloudBaseQuery
  skip: (offset: number) => CloudBaseQuery
  get: () => Promise<CloudBaseQueryResult>
}

export interface CloudBaseDocumentReference {
  get: () => Promise<CloudBaseDocumentResult>
  remove: () => Promise<unknown>
  set: (data: CloudBaseSetInput) => Promise<unknown>
}

export interface CloudBaseCollection extends CloudBaseQuery {
  doc: (id: string) => CloudBaseDocumentReference
}

export interface CloudBaseTransaction {
  collection: (name: string) => CloudBaseCollection
}

export interface CloudBaseDatabase extends CloudBaseTransaction {
  command: {
    lte: (value: number) => unknown
  }
  runTransaction: <T>(operation: (transaction: CloudBaseTransaction) => Promise<T>) => Promise<T>
}

export interface CloudBaseRuntimeRepositories {
  tasks: TaskRepository
  usage: UsageRepository
  runtimeControl: RuntimeControlRepository
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function documentData(result: CloudBaseDocumentResult): Record<string, unknown> | undefined {
  if (Array.isArray(result.data)) {
    const first = result.data[0]
    return isRecord(first) ? first : undefined
  }
  return isRecord(result.data) ? result.data : undefined
}

function queryData(result: CloudBaseQueryResult): Record<string, unknown>[] {
  return Array.isArray(result.data) ? result.data.filter(isRecord) : []
}

function withoutUndefined(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map(withoutUndefined)
  if (!isRecord(value))
    return value

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, withoutUndefined(item)]),
  )
}

function toDocument(value: { id: string }): Record<string, unknown> {
  return withoutUndefined(value) as Record<string, unknown>
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value)
    throw new TypeError(`${field} must be a non-empty string`)
  return value
}

function taskFromDocument(value: Record<string, unknown>): RuntimeTaskRecord {
  const id = requireString(value.id ?? value._id, 'task.id')
  const uid = requireString(value.uid, 'task.uid')
  const status = requireString(value.status, 'task.status')
  const task: Record<string, unknown> = { ...value, id, uid, status }
  delete task._id
  return task as unknown as RuntimeTaskRecord
}

function usageFromDocument(value: Record<string, unknown>): RuntimeUsageRecord {
  const usage = { ...value }
  delete usage._id
  return usage as unknown as RuntimeUsageRecord
}

function budgetFromDocument(value: Record<string, unknown>): DailyBudgetDocument {
  const id = requireString(value.id ?? value._id, 'budget.id')
  const budget: Record<string, unknown> = { ...value, id }
  delete budget._id
  return budget as unknown as DailyBudgetDocument
}

function policyFromDocument(value: Record<string, unknown>): RuntimePolicyDocument {
  const id = requireString(value.id ?? value._id, 'policy.id')
  const policy: Record<string, unknown> = { ...value, id }
  delete policy._id
  return policy as unknown as RuntimePolicyDocument
}

function usageDocumentId(taskId: string, attempt: number): string {
  return createHash('sha256')
    .update(JSON.stringify(['ai_usage_record', taskId, attempt]))
    .digest('hex')
    .slice(0, 32)
}

class CloudBaseTaskRepository implements TaskRepository {
  constructor(private readonly database: CloudBaseDatabase) {}

  async create(task: RuntimeTaskRecord): Promise<void> {
    await this.database.runTransaction(async (transaction) => {
      const reference = transaction.collection(TASKS_COLLECTION).doc(task.id)
      if (documentData(await reference.get()))
        throw new Error(`Task already exists: ${task.id}`)
      await reference.set(toDocument(task))
    })
  }

  async get(taskId: string): Promise<RuntimeTaskRecord | undefined> {
    const value = documentData(await this.database.collection(TASKS_COLLECTION).doc(taskId).get())
    return value ? taskFromDocument(value) : undefined
  }

  async update(
    taskId: string,
    updater: (task: RuntimeTaskRecord) => RuntimeTaskRecord,
  ): Promise<RuntimeTaskRecord> {
    return this.database.runTransaction(async (transaction) => {
      const reference = transaction.collection(TASKS_COLLECTION).doc(taskId)
      const value = documentData(await reference.get())
      if (!value)
        throw new Error(`Task does not exist: ${taskId}`)
      const updated = updater(taskFromDocument(value))
      if (updated.id !== taskId)
        throw new Error('Task updater cannot change the task id')
      await reference.set(toDocument(updated))
      return structuredClone(updated)
    })
  }

  async claimNext(input: ClaimTaskInput): Promise<RuntimeTaskRecord | undefined> {
    const candidates = [
      ...queryData(await this.database.collection(TASKS_COLLECTION)
        .where({ status: 'queued' })
        .orderBy('createdAt', 'asc')
        .limit(1)
        .get()),
      ...queryData(await this.database.collection(TASKS_COLLECTION)
        .where({ status: 'running', leaseExpiresAt: this.database.command.lte(input.now) })
        .orderBy('leaseExpiresAt', 'asc')
        .limit(1)
        .get()),
    ]

    for (const candidate of candidates) {
      const taskId = requireString(candidate.id ?? candidate._id, 'task.id')
      const claimed = await this.database.runTransaction(async (transaction) => {
        const reference = transaction.collection(TASKS_COLLECTION).doc(taskId)
        const value = documentData(await reference.get())
        if (!value)
          return undefined
        const current = taskFromDocument(value)
        const queued = current.status === 'queued'
        const expired = current.status === 'running' && (current.leaseExpiresAt ?? Number.POSITIVE_INFINITY) <= input.now
        if (!queued && !expired)
          return undefined

        const lease = {
          attempt: queued ? (current.attempt ?? 0) + 1 : (current.attempt ?? 1),
          leaseExpiresAt: input.now + input.leaseDurationMs,
          leaseOwner: input.leaseOwner,
        }
        const updated = queued
          ? transitionTask(current, 'running', input.now, lease)
          : patchTask(current, input.now, lease)
        await reference.set(toDocument(updated))
        return updated
      })
      if (claimed)
        return claimed
    }
    return undefined
  }

  async renewLease(input: RenewTaskLeaseInput): Promise<boolean> {
    return this.database.runTransaction(async (transaction) => {
      const reference = transaction.collection(TASKS_COLLECTION).doc(input.taskId)
      const value = documentData(await reference.get())
      if (!value)
        return false
      const current = taskFromDocument(value)
      if (current.status !== 'running' || current.leaseOwner !== input.leaseOwner)
        return false
      const updated = patchTask(current, input.now, {
        leaseExpiresAt: input.now + input.leaseDurationMs,
      })
      await reference.set(toDocument(updated))
      return true
    })
  }

  async deleteExpired(taskId: string, now: number): Promise<boolean> {
    return this.database.runTransaction(async (transaction) => {
      const reference = transaction.collection(TASKS_COLLECTION).doc(taskId)
      const value = documentData(await reference.get())
      if (!value || !isTaskContentExpired(taskFromDocument(value), now))
        return false
      await reference.remove()
      return true
    })
  }

  async list(): Promise<RuntimeTaskRecord[]> {
    const tasks: RuntimeTaskRecord[] = []
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const page = queryData(await this.database.collection(TASKS_COLLECTION)
        .orderBy('createdAt', 'asc')
        .skip(offset)
        .limit(PAGE_SIZE)
        .get())
      tasks.push(...page.map(taskFromDocument))
      if (page.length < PAGE_SIZE)
        return tasks
    }
  }
}

class CloudBaseUsageRepository implements UsageRepository {
  constructor(private readonly database: CloudBaseDatabase) {}

  async append(record: RuntimeUsageRecord): Promise<void> {
    const id = usageDocumentId(record.taskId, record.attempt)
    await this.database.runTransaction(async (transaction) => {
      const reference = transaction.collection(USAGE_COLLECTION).doc(id)
      if (documentData(await reference.get()))
        throw new Error(`Usage attempt already exists: ${record.taskId}:${record.attempt}`)
      if (record.providerRequestId) {
        const duplicate = queryData(await transaction.collection(USAGE_COLLECTION)
          .where({
            providerGroup: record.providerGroup,
            providerRequestId: record.providerRequestId,
          })
          .limit(1)
          .get())[0]
        if (duplicate)
          throw new ProviderRequestConflictError(record.providerGroup, record.providerRequestId)
      }
      await reference.set(withoutUndefined(record) as Record<string, unknown>)
    })
  }

  async getAttempt(taskId: string, attempt: number): Promise<RuntimeUsageRecord | undefined> {
    const id = usageDocumentId(taskId, attempt)
    const value = documentData(await this.database.collection(USAGE_COLLECTION).doc(id).get())
    return value ? usageFromDocument(value) : undefined
  }

  async listByTask(taskId: string): Promise<RuntimeUsageRecord[]> {
    const result = await this.database.collection(USAGE_COLLECTION)
      .where({ taskId })
      .orderBy('attempt', 'asc')
      .limit(PAGE_SIZE)
      .get()
    return queryData(result).map(usageFromDocument)
  }
}

class CloudBaseRuntimeControlRepository implements RuntimeControlRepository {
  constructor(private readonly database: CloudBaseDatabase) {}

  async getActivePolicy(): Promise<RuntimePolicyDocument | undefined> {
    const value = documentData(await this.database.collection(CONTROL_COLLECTION).doc('policy:active').get())
    return value ? policyFromDocument(value) : undefined
  }

  async setActivePolicy(policy: RuntimePolicyDocument): Promise<void> {
    await this.database.runTransaction(async (transaction) => {
      await transaction.collection(CONTROL_COLLECTION).doc('policy:active').set({
        data: toDocument(policy),
      })
    })
  }

  async getDailyBudget(dateKey: string): Promise<DailyBudgetDocument | undefined> {
    const value = documentData(await this.database.collection(CONTROL_COLLECTION).doc(`budget:${dateKey}`).get())
    return value ? budgetFromDocument(value) : undefined
  }

  async transactDailyBudget<T>(
    dateKey: string,
    update: (current: DailyBudgetDocument | undefined) => {
      document: DailyBudgetDocument
      result: T
    },
  ): Promise<T> {
    return this.database.runTransaction(async (transaction) => {
      const reference = transaction.collection(CONTROL_COLLECTION).doc(`budget:${dateKey}`)
      const value = documentData(await reference.get())
      const operation = update(value ? budgetFromDocument(value) : undefined)
      await reference.set(toDocument(operation.document))
      return structuredClone(operation.result)
    })
  }
}

export function createCloudBaseRepositories(database: CloudBaseDatabase): CloudBaseRuntimeRepositories {
  return {
    tasks: new CloudBaseTaskRepository(database),
    usage: new CloudBaseUsageRepository(database),
    runtimeControl: new CloudBaseRuntimeControlRepository(database),
  }
}
