import type { AgentCapabilityId } from '../contracts/v1.js'
import type { Clock } from '../dependencies.js'
import type { RuntimeControlRepository } from '../repositories/types.js'
import type { PricingSnapshot } from './pricing.js'

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000
const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER)

export type BudgetReservationStatus = 'reserved' | 'settled' | 'released'
export type BudgetOperationKind = 'reserve' | 'settle' | 'release'

export interface RuntimePolicyDocument {
  id: 'policy:active'
  enabled: boolean
  version: string
  betaOnly: true
  initialGrantMicroPoints: number
  perUserDailyTaskLimit: number
  perUserDailyChargeLimitMicroPoints: number
  globalDailyProviderCapMicroCny: number
  providerGroup: 'cloudbase'
  model: string
  modelEnabled: boolean
  pricing: Readonly<PricingSnapshot>
  capabilities: Record<AgentCapabilityId, boolean>
  updatedBy: string
  updateServiceActor?: string
  updateReason?: string
  updateIdempotencyKey?: string
  updateFingerprint?: string
  updatedAt: number
}

export interface BudgetReservationRecord {
  taskId: string
  status: BudgetReservationStatus
  reservedProviderCostMicroCny: number
  actualProviderCostMicroCny: number
}

export interface BudgetOperationReceipt {
  kind: BudgetOperationKind
  taskId: string
  dateKey: string
  reservedProviderCostMicroCny: number
  actualProviderCostMicroCny: number
}

export interface BudgetOperationRecord {
  fingerprint: string
  receipt: BudgetOperationReceipt
}

export interface DailyBudgetDocument {
  id: string
  dateKey: string
  reservedProviderCostMicroCny: number
  actualProviderCostMicroCny: number
  reservations: Record<string, BudgetReservationRecord>
  operations: Record<string, BudgetOperationRecord>
  version: number
  updatedAt: number
}

export interface CreateDefaultRuntimePolicyInput {
  version: string
  model: string
  pricing: Readonly<PricingSnapshot>
}

export interface ReservePlatformBudgetInput {
  taskId: string
  singleAttemptMaxMicroCny: number
  maxAutomaticAttempts: number
  capMicroCny: number
  idempotencyKey: string
}

export interface SettlePlatformBudgetInput {
  taskId: string
  dateKey: string
  actualProviderCostMicroCny: number
  idempotencyKey: string
}

export interface ReleasePlatformBudgetInput {
  taskId: string
  dateKey: string
  idempotencyKey: string
}

export class PlatformBudgetExceededError extends Error {
  readonly code = 'PLATFORM_DAILY_LIMIT'

  constructor() {
    super('Daily provider budget is exhausted')
  }
}

export class BudgetIdempotencyConflictError extends Error {
  readonly code = 'BUDGET_IDEMPOTENCY_CONFLICT'

  constructor() {
    super('Budget idempotency key was reused with different semantics')
  }
}

function assertNonNegativeSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new TypeError(`${field} must be a non-negative safe integer`)
}

function assertPositiveSafeInteger(value: number, field: string): void {
  assertNonNegativeSafeInteger(value, field)
  if (value === 0)
    throw new TypeError(`${field} must be greater than zero`)
}

function safeAdd(values: readonly number[], field: string): number {
  const result = values.reduce((sum, value) => sum + BigInt(value), 0n)
  if (result > MAX_SAFE_INTEGER)
    throw new RangeError(`${field} exceeds the safe integer range`)
  return Number(result)
}

function safeMultiply(left: number, right: number, field: string): number {
  assertNonNegativeSafeInteger(left, `${field} left operand`)
  assertNonNegativeSafeInteger(right, `${field} right operand`)
  const result = BigInt(left) * BigInt(right)
  if (result > MAX_SAFE_INTEGER)
    throw new RangeError(`${field} exceeds the safe integer range`)
  return Number(result)
}

function createEmptyBudget(dateKey: string, now: number): DailyBudgetDocument {
  return {
    id: `budget:${dateKey}`,
    dateKey,
    reservedProviderCostMicroCny: 0,
    actualProviderCostMicroCny: 0,
    reservations: {},
    operations: {},
    version: 0,
    updatedAt: now,
  }
}

function existingReceipt(
  document: DailyBudgetDocument,
  idempotencyKey: string,
  fingerprint: string,
): BudgetOperationReceipt | undefined {
  const operation = document.operations[idempotencyKey]
  if (!operation)
    return undefined
  if (operation.fingerprint !== fingerprint)
    throw new BudgetIdempotencyConflictError()
  return structuredClone(operation.receipt)
}

function recordOperation(
  document: DailyBudgetDocument,
  idempotencyKey: string,
  fingerprint: string,
  receipt: BudgetOperationReceipt,
  now: number,
): void {
  document.operations[idempotencyKey] = { fingerprint, receipt: structuredClone(receipt) }
  document.version += 1
  document.updatedAt = now
}

export function shanghaiDateKey(now: number): string {
  assertNonNegativeSafeInteger(now, 'now')
  return new Date(now + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10)
}

export function createDefaultRuntimePolicy(input: CreateDefaultRuntimePolicyInput): RuntimePolicyDocument {
  if (!input.version)
    throw new TypeError('policy version is required')
  if (!input.model)
    throw new TypeError('policy model is required')

  return {
    id: 'policy:active',
    enabled: false,
    version: input.version,
    betaOnly: true,
    initialGrantMicroPoints: 0,
    perUserDailyTaskLimit: 20,
    perUserDailyChargeLimitMicroPoints: 500_000,
    globalDailyProviderCapMicroCny: 50_000_000,
    providerGroup: 'cloudbase',
    model: input.model,
    modelEnabled: false,
    pricing: input.pricing,
    capabilities: {
      'generate-outline': false,
      'generate-chapter-draft': false,
      'suggest-plot': false,
      'simulate-roleplay': false,
      'check-consistency': false,
    },
    updatedBy: 'system',
    updatedAt: 0,
  }
}

export function assertRuntimePolicyAllows(
  policy: RuntimePolicyDocument,
  capability: AgentCapabilityId,
): void {
  if (!policy.enabled)
    throw new Error('AI runtime is disabled')
  if (!policy.modelEnabled)
    throw new Error('Runtime model is disabled')
  if (!policy.capabilities[capability])
    throw new Error(`Runtime capability is disabled: ${capability}`)
}

export class PlatformBudgetService {
  constructor(
    private readonly repository: RuntimeControlRepository,
    private readonly clock: Clock,
  ) {}

  async getBudget(dateKey: string): Promise<DailyBudgetDocument | undefined> {
    return this.repository.getDailyBudget(dateKey)
  }

  async reserve(input: ReservePlatformBudgetInput): Promise<BudgetOperationReceipt> {
    assertPositiveSafeInteger(input.capMicroCny, 'capMicroCny')
    assertNonNegativeSafeInteger(input.singleAttemptMaxMicroCny, 'singleAttemptMaxMicroCny')
    assertPositiveSafeInteger(input.maxAutomaticAttempts, 'maxAutomaticAttempts')
    if (!input.taskId || !input.idempotencyKey)
      throw new TypeError('taskId and idempotencyKey are required')

    const now = this.clock.now()
    const dateKey = shanghaiDateKey(now)
    const reservedProviderCostMicroCny = safeMultiply(
      input.singleAttemptMaxMicroCny,
      input.maxAutomaticAttempts,
      'platform reservation',
    )
    const fingerprint = [
      'reserve',
      input.taskId,
      reservedProviderCostMicroCny,
      input.capMicroCny,
    ].join(':')

    return this.repository.transactDailyBudget(dateKey, (current) => {
      const document = current ?? createEmptyBudget(dateKey, now)
      const prior = existingReceipt(document, input.idempotencyKey, fingerprint)
      if (prior)
        return { document, result: prior }
      if (document.reservations[input.taskId])
        throw new Error(`Task already has a platform budget reservation: ${input.taskId}`)

      const projected = safeAdd([
        document.actualProviderCostMicroCny,
        document.reservedProviderCostMicroCny,
        reservedProviderCostMicroCny,
      ], 'projected platform budget')
      if (document.actualProviderCostMicroCny >= input.capMicroCny || projected > input.capMicroCny)
        throw new PlatformBudgetExceededError()

      document.reservedProviderCostMicroCny = safeAdd([
        document.reservedProviderCostMicroCny,
        reservedProviderCostMicroCny,
      ], 'reserved platform budget')
      document.reservations[input.taskId] = {
        taskId: input.taskId,
        status: 'reserved',
        reservedProviderCostMicroCny,
        actualProviderCostMicroCny: 0,
      }
      const receipt: BudgetOperationReceipt = {
        kind: 'reserve',
        taskId: input.taskId,
        dateKey,
        reservedProviderCostMicroCny,
        actualProviderCostMicroCny: 0,
      }
      recordOperation(document, input.idempotencyKey, fingerprint, receipt, now)
      return { document, result: receipt }
    })
  }

  async settle(input: SettlePlatformBudgetInput): Promise<BudgetOperationReceipt> {
    assertNonNegativeSafeInteger(input.actualProviderCostMicroCny, 'actualProviderCostMicroCny')
    if (!input.taskId || !input.dateKey || !input.idempotencyKey)
      throw new TypeError('taskId, dateKey and idempotencyKey are required')
    const now = this.clock.now()
    const fingerprint = ['settle', input.taskId, input.actualProviderCostMicroCny].join(':')

    return this.repository.transactDailyBudget(input.dateKey, (current) => {
      if (!current)
        throw new Error(`Platform budget does not exist: ${input.dateKey}`)
      const prior = existingReceipt(current, input.idempotencyKey, fingerprint)
      if (prior)
        return { document: current, result: prior }
      const reservation = current.reservations[input.taskId]
      if (!reservation || reservation.status !== 'reserved')
        throw new Error(`Active platform reservation does not exist: ${input.taskId}`)
      if (input.actualProviderCostMicroCny > reservation.reservedProviderCostMicroCny)
        throw new RangeError('Actual provider cost exceeds the reserved maximum')

      current.reservedProviderCostMicroCny -= reservation.reservedProviderCostMicroCny
      current.actualProviderCostMicroCny = safeAdd([
        current.actualProviderCostMicroCny,
        input.actualProviderCostMicroCny,
      ], 'actual platform budget')
      reservation.status = 'settled'
      reservation.actualProviderCostMicroCny = input.actualProviderCostMicroCny
      const receipt: BudgetOperationReceipt = {
        kind: 'settle',
        taskId: input.taskId,
        dateKey: input.dateKey,
        reservedProviderCostMicroCny: 0,
        actualProviderCostMicroCny: input.actualProviderCostMicroCny,
      }
      recordOperation(current, input.idempotencyKey, fingerprint, receipt, now)
      return { document: current, result: receipt }
    })
  }

  async release(input: ReleasePlatformBudgetInput): Promise<BudgetOperationReceipt> {
    if (!input.taskId || !input.dateKey || !input.idempotencyKey)
      throw new TypeError('taskId, dateKey and idempotencyKey are required')
    const now = this.clock.now()
    const fingerprint = ['release', input.taskId].join(':')

    return this.repository.transactDailyBudget(input.dateKey, (current) => {
      if (!current)
        throw new Error(`Platform budget does not exist: ${input.dateKey}`)
      const prior = existingReceipt(current, input.idempotencyKey, fingerprint)
      if (prior)
        return { document: current, result: prior }
      const reservation = current.reservations[input.taskId]
      if (!reservation || reservation.status !== 'reserved')
        throw new Error(`Active platform reservation does not exist: ${input.taskId}`)

      current.reservedProviderCostMicroCny -= reservation.reservedProviderCostMicroCny
      reservation.status = 'released'
      const receipt: BudgetOperationReceipt = {
        kind: 'release',
        taskId: input.taskId,
        dateKey: input.dateKey,
        reservedProviderCostMicroCny: 0,
        actualProviderCostMicroCny: 0,
      }
      recordOperation(current, input.idempotencyKey, fingerprint, receipt, now)
      return { document: current, result: receipt }
    })
  }
}
