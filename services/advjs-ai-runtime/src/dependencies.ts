import type { AuthVerifier } from './auth/types.js'
import type { CapabilityRegistry } from './capabilities/registry.js'
import type { ModelExecutor } from './executors/types.js'
import type { RuntimeControlRepository, TaskRepository, UsageRepository } from './repositories/types.js'

export interface Clock {
  now: () => number
}

export interface IdGenerator {
  generate: (prefix: string) => string
}

export interface AiPointAccount {
  uid: string
  availableMicroPoints: number
  reservedMicroPoints: number
  chargedMicroPoints?: number
  activeTask?: string
}

export interface ReserveAiPointsInput {
  uid: string
  taskId: string
  microPoints: number
  idempotencyKey: string
}

export interface SettleAiPointsInput {
  uid: string
  taskId: string
  chargedMicroPoints: number
  idempotencyKey: string
}

export interface ReleaseAiPointsInput {
  uid: string
  taskId: string
  idempotencyKey: string
}

export interface AiPointTransactionPage {
  items: readonly Readonly<Record<string, string | number | boolean | null>>[]
  nextCursor?: string
}

export interface AccountApi {
  getAccount: (uid: string) => Promise<AiPointAccount>
  reserve: (input: ReserveAiPointsInput) => Promise<void>
  settle: (input: SettleAiPointsInput) => Promise<void>
  release: (input: ReleaseAiPointsInput) => Promise<void>
  listTransactions: (uid: string, cursor?: string) => Promise<AiPointTransactionPage>
}

export interface RuntimeDependencies {
  clock: Clock
  ids: IdGenerator
  auth: AuthVerifier
  accountApi: AccountApi
  tasks: TaskRepository
  usage: UsageRepository
  runtimeControl: RuntimeControlRepository
  modelExecutor: ModelExecutor
  capabilities: CapabilityRegistry
}
