import type { DailyBudgetDocument, RuntimePolicyDocument } from '../domain/budget.js'
import type { RuntimeTaskRecord, RuntimeUsageRecord } from '../domain/task.js'

export interface ClaimTaskInput {
  leaseOwner: string
  leaseDurationMs: number
  now: number
}

export interface RenewTaskLeaseInput extends ClaimTaskInput {
  taskId: string
}

export interface TaskRepository {
  create: (task: RuntimeTaskRecord) => Promise<void>
  get: (taskId: string) => Promise<RuntimeTaskRecord | undefined>
  update: (
    taskId: string,
    updater: (task: RuntimeTaskRecord) => RuntimeTaskRecord,
  ) => Promise<RuntimeTaskRecord>
  claimNext: (input: ClaimTaskInput) => Promise<RuntimeTaskRecord | undefined>
  renewLease: (input: RenewTaskLeaseInput) => Promise<boolean>
  deleteExpired: (taskId: string, now: number) => Promise<boolean>
  list: () => Promise<RuntimeTaskRecord[]>
}

export interface UsageRepository {
  append: (record: RuntimeUsageRecord) => Promise<void>
  getAttempt: (taskId: string, attempt: number) => Promise<RuntimeUsageRecord | undefined>
  listByTask: (taskId: string) => Promise<RuntimeUsageRecord[]>
}

export class ProviderRequestConflictError extends Error {
  constructor(providerGroup: string, providerRequestId: string) {
    super(`Provider request already exists: ${providerGroup}:${providerRequestId}`)
  }
}

export interface RuntimeControlRepository {
  getActivePolicy: () => Promise<RuntimePolicyDocument | undefined>
  setActivePolicy: (policy: RuntimePolicyDocument) => Promise<void>
  getDailyBudget: (dateKey: string) => Promise<DailyBudgetDocument | undefined>
  transactDailyBudget: <T>(
    dateKey: string,
    update: (current: DailyBudgetDocument | undefined) => {
      document: DailyBudgetDocument
      result: T
    },
  ) => Promise<T>
}
