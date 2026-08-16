import type {
  AccountApi,
  AiPointAccount,
  AiPointTransactionPage,
  Clock,
  ReleaseAiPointsInput,
  ReserveAiPointsInput,
  SettleAiPointsInput,
} from '../dependencies.js'

const CURSOR_PATTERN = /^offset:(\d+)$/
const PAGE_SIZE = 20

export type AccountApiInvoke = (input: Record<string, unknown>) => Promise<unknown>

export interface AccountApiClientOptions {
  serviceToken: string
  appId: string
  scope: string
  activeTaskTtlMs: number
  clock: Clock
  invoke: AccountApiInvoke
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function safeInteger(value: unknown, fallback = 0): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : fallback
}

function identifier(value: string, field: string): string {
  if (!value || value.length > 128 || !/^[\w.:-]+$/.test(value))
    throw new TypeError(`${field} is invalid`)
  return value
}

function transactionSummary(value: unknown): Readonly<Record<string, string | number | boolean | null>> | undefined {
  if (!isRecord(value))
    return undefined
  const allowed = [
    'type',
    'taskId',
    'availableDelta',
    'reservedDelta',
    'chargedMicroPoints',
    'availableAfter',
    'reservedAfter',
    'createdAt',
  ]
  return Object.fromEntries(
    allowed
      .filter(key => ['string', 'number', 'boolean'].includes(typeof value[key]) || value[key] === null)
      .map(key => [key, value[key] as string | number | boolean | null]),
  )
}

export class AccountApiClient implements AccountApi {
  readonly #serviceToken: string

  constructor(private readonly options: AccountApiClientOptions) {
    if (options.serviceToken.length < 24)
      throw new TypeError('Dedicated account-api credential is missing or too short')
    identifier(options.appId, 'appId')
    identifier(options.scope, 'scope')
    if (!Number.isSafeInteger(options.activeTaskTtlMs) || options.activeTaskTtlMs < 1)
      throw new TypeError('activeTaskTtlMs must be a positive safe integer')
    this.#serviceToken = options.serviceToken
  }

  async getAccount(uid: string): Promise<AiPointAccount> {
    const userId = identifier(uid, 'uid')
    const result = await this.options.invoke({
      action: 'getAiPointAccountForUser',
      serviceToken: this.#serviceToken,
      userId,
    })
    if (!isRecord(result)) {
      return {
        uid: userId,
        availableMicroPoints: 0,
        reservedMicroPoints: 0,
        chargedMicroPoints: 0,
      }
    }
    const activeTask = isRecord(result.activeTask) && typeof result.activeTask.taskId === 'string'
      ? result.activeTask.taskId
      : undefined
    return {
      uid: userId,
      availableMicroPoints: safeInteger(result.availableMicroPoints),
      reservedMicroPoints: safeInteger(result.reservedMicroPoints),
      chargedMicroPoints: safeInteger(result.lifetimeChargedMicroPoints),
      ...(activeTask ? { activeTask } : {}),
    }
  }

  async reserve(input: ReserveAiPointsInput): Promise<void> {
    await this.options.invoke({
      action: 'reserveAiPointsForTask',
      serviceToken: this.#serviceToken,
      userId: identifier(input.uid, 'uid'),
      appId: this.options.appId,
      scope: this.options.scope,
      taskId: identifier(input.taskId, 'taskId'),
      amountMicroPoints: input.microPoints,
      activeTaskExpiresAt: this.options.clock.now() + this.options.activeTaskTtlMs,
      idempotencyKey: identifier(input.idempotencyKey, 'idempotencyKey'),
    })
  }

  async settle(input: SettleAiPointsInput): Promise<void> {
    await this.options.invoke({
      action: 'settleAiPointsForTask',
      serviceToken: this.#serviceToken,
      userId: identifier(input.uid, 'uid'),
      appId: this.options.appId,
      scope: this.options.scope,
      taskId: identifier(input.taskId, 'taskId'),
      chargedMicroPoints: input.chargedMicroPoints,
      idempotencyKey: identifier(input.idempotencyKey, 'idempotencyKey'),
    })
  }

  async release(input: ReleaseAiPointsInput): Promise<void> {
    await this.options.invoke({
      action: 'releaseAiPointsForTask',
      serviceToken: this.#serviceToken,
      userId: identifier(input.uid, 'uid'),
      appId: this.options.appId,
      scope: this.options.scope,
      taskId: identifier(input.taskId, 'taskId'),
      reason: 'runtime_terminal_release',
      idempotencyKey: identifier(input.idempotencyKey, 'idempotencyKey'),
    })
  }

  async listTransactions(uid: string, cursor?: string): Promise<AiPointTransactionPage> {
    let skip = 0
    if (cursor) {
      const match = CURSOR_PATTERN.exec(cursor)
      if (!match?.[1])
        throw new TypeError('Transaction cursor is invalid')
      skip = Number(match[1])
      if (!Number.isSafeInteger(skip))
        throw new TypeError('Transaction cursor is invalid')
    }
    const result = await this.options.invoke({
      action: 'listAiPointTransactionsForUser',
      serviceToken: this.#serviceToken,
      userId: identifier(uid, 'uid'),
      skip,
      limit: PAGE_SIZE,
    })
    if (!isRecord(result))
      return { items: [] }
    const items = Array.isArray(result.items)
      ? result.items.map(transactionSummary).filter(item => item !== undefined)
      : []
    const nextSkip = safeInteger(result.nextSkip, -1)
    return {
      items,
      ...(nextSkip >= 0 ? { nextCursor: `offset:${nextSkip}` } : {}),
    }
  }
}
