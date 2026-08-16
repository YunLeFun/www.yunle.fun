import type { DailyBudgetDocument, RuntimePolicyDocument } from '../domain/budget.js'
import type { RuntimeTaskRecord, RuntimeUsageRecord } from '../domain/task.js'
import type { ClaimTaskInput, RenewTaskLeaseInput, RuntimeControlRepository, TaskRepository, UsageRepository } from './types.js'
import { isTaskContentExpired, patchTask, transitionTask } from '../domain/task.js'
import { ProviderRequestConflictError } from './types.js'

function cloneTask(task: RuntimeTaskRecord): RuntimeTaskRecord {
  return { ...task }
}

export class InMemoryTaskRepository implements TaskRepository {
  readonly #tasks = new Map<string, RuntimeTaskRecord>()

  async create(task: RuntimeTaskRecord): Promise<void> {
    if (this.#tasks.has(task.id))
      throw new Error(`Task already exists: ${task.id}`)
    this.#tasks.set(task.id, cloneTask(task))
  }

  async get(taskId: string): Promise<RuntimeTaskRecord | undefined> {
    const task = this.#tasks.get(taskId)
    return task ? cloneTask(task) : undefined
  }

  async update(
    taskId: string,
    updater: (task: RuntimeTaskRecord) => RuntimeTaskRecord,
  ): Promise<RuntimeTaskRecord> {
    const current = this.#tasks.get(taskId)
    if (!current)
      throw new Error(`Task does not exist: ${taskId}`)
    const updated = updater(cloneTask(current))
    if (updated.id !== taskId)
      throw new Error('Task updater cannot change the task id')
    this.#tasks.set(taskId, cloneTask(updated))
    return cloneTask(updated)
  }

  async claimNext(input: ClaimTaskInput): Promise<RuntimeTaskRecord | undefined> {
    const candidate = [...this.#tasks.values()]
      .sort((left, right) => (left.createdAt ?? 0) - (right.createdAt ?? 0))
      .find(task => task.status === 'queued'
        || (task.status === 'running' && (task.leaseExpiresAt ?? Number.POSITIVE_INFINITY) <= input.now))
    if (!candidate)
      return undefined

    const lease = {
      attempt: candidate.status === 'queued' ? (candidate.attempt ?? 0) + 1 : (candidate.attempt ?? 1),
      leaseExpiresAt: input.now + input.leaseDurationMs,
      leaseOwner: input.leaseOwner,
    }
    const updated = candidate.status === 'queued'
      ? transitionTask(candidate, 'running', input.now, lease)
      : patchTask(candidate, input.now, lease)
    this.#tasks.set(updated.id, cloneTask(updated))
    return cloneTask(updated)
  }

  async renewLease(input: RenewTaskLeaseInput): Promise<boolean> {
    const task = this.#tasks.get(input.taskId)
    if (!task || task.status !== 'running' || task.leaseOwner !== input.leaseOwner)
      return false
    const updated = patchTask(task, input.now, {
      leaseExpiresAt: input.now + input.leaseDurationMs,
    })
    this.#tasks.set(task.id, updated)
    return true
  }

  async deleteExpired(taskId: string, now: number): Promise<boolean> {
    const task = this.#tasks.get(taskId)
    if (!task || !isTaskContentExpired(task, now))
      return false
    this.#tasks.delete(taskId)
    return true
  }

  async list(): Promise<RuntimeTaskRecord[]> {
    return [...this.#tasks.values()].map(cloneTask)
  }
}

export class InMemoryUsageRepository implements UsageRepository {
  readonly records: RuntimeUsageRecord[] = []

  async append(record: RuntimeUsageRecord): Promise<void> {
    if (this.records.some(item => item.taskId === record.taskId && item.attempt === record.attempt))
      throw new Error(`Usage attempt already exists: ${record.taskId}:${record.attempt}`)
    if (record.providerRequestId && this.records.some(item => (
      item.providerGroup === record.providerGroup && item.providerRequestId === record.providerRequestId
    ))) {
      throw new ProviderRequestConflictError(record.providerGroup, record.providerRequestId)
    }
    this.records.push(structuredClone(record))
  }

  async getAttempt(taskId: string, attempt: number): Promise<RuntimeUsageRecord | undefined> {
    const record = this.records.find(item => item.taskId === taskId && item.attempt === attempt)
    return record ? structuredClone(record) : undefined
  }

  async listByTask(taskId: string): Promise<RuntimeUsageRecord[]> {
    return this.records
      .filter(item => item.taskId === taskId)
      .sort((left, right) => left.attempt - right.attempt)
      .map(record => structuredClone(record))
  }
}

export class InMemoryRuntimeControlRepository implements RuntimeControlRepository {
  readonly #budgets = new Map<string, DailyBudgetDocument>()
  #policy: RuntimePolicyDocument | undefined

  constructor(policy?: RuntimePolicyDocument) {
    this.#policy = policy ? structuredClone(policy) : undefined
  }

  async getActivePolicy(): Promise<RuntimePolicyDocument | undefined> {
    return this.#policy ? structuredClone(this.#policy) : undefined
  }

  async setActivePolicy(policy: RuntimePolicyDocument): Promise<void> {
    this.#policy = structuredClone(policy)
  }

  async getDailyBudget(dateKey: string): Promise<DailyBudgetDocument | undefined> {
    const budget = this.#budgets.get(dateKey)
    return budget ? structuredClone(budget) : undefined
  }

  async transactDailyBudget<T>(
    dateKey: string,
    update: (current: DailyBudgetDocument | undefined) => {
      document: DailyBudgetDocument
      result: T
    },
  ): Promise<T> {
    const current = this.#budgets.get(dateKey)
    const transaction = update(current ? structuredClone(current) : undefined)
    this.#budgets.set(dateKey, structuredClone(transaction.document))
    return structuredClone(transaction.result)
  }
}
