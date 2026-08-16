import type { AuthVerifier, RuntimeIdentity } from '../auth/types.js'
import type { AccountApi, AiPointAccount, Clock, IdGenerator, ReleaseAiPointsInput, ReserveAiPointsInput, RuntimeDependencies, SettleAiPointsInput } from '../dependencies.js'
import { createServerCapabilityRegistry } from '../capabilities/server-registry.js'
import { createDefaultRuntimePolicy } from '../domain/budget.js'
import { createBetaPricingSnapshot } from '../domain/pricing.js'
import { FakeModelExecutor } from '../executors/fake-model.js'
import { InMemoryRuntimeControlRepository, InMemoryTaskRepository, InMemoryUsageRepository } from '../repositories/in-memory.js'

class FixedClock implements Clock {
  constructor(private readonly value: number) {}

  now(): number {
    return this.value
  }
}

class SequentialIdGenerator implements IdGenerator {
  #sequence = 0

  generate(prefix: string): string {
    this.#sequence += 1
    return `${prefix}_fake_${this.#sequence}`
  }
}

class FakeAuthVerifier implements AuthVerifier {
  async verifyAccessToken(accessToken: string): Promise<RuntimeIdentity> {
    if (!accessToken)
      throw new Error('Access token is required')
    return { uid: 'uid_fixture_001' }
  }
}

class InMemoryAccountApi implements AccountApi {
  readonly #accounts = new Map<string, AiPointAccount>()
  readonly #operations = new Map<string, string>()

  async getAccount(uid: string): Promise<AiPointAccount> {
    return { ...this.#getOrCreate(uid) }
  }

  async listTransactions(): Promise<{ items: [] }> {
    return { items: [] }
  }

  async reserve(input: ReserveAiPointsInput): Promise<void> {
    const fingerprint = ['reserve', input.uid, input.taskId, input.microPoints].join(':')
    if (this.#hasOperation(input.idempotencyKey, fingerprint))
      return
    if (!Number.isSafeInteger(input.microPoints) || input.microPoints < 0)
      throw new TypeError('microPoints must be a non-negative safe integer')

    const account = this.#getOrCreate(input.uid)
    if (account.activeTask && account.activeTask !== input.taskId)
      throw new Error('Account already has an active task')
    if (account.availableMicroPoints < input.microPoints)
      throw new Error('Insufficient AI points')

    account.availableMicroPoints -= input.microPoints
    account.reservedMicroPoints += input.microPoints
    account.activeTask = input.taskId
    this.#operations.set(input.idempotencyKey, fingerprint)
  }

  async settle(input: SettleAiPointsInput): Promise<void> {
    const fingerprint = ['settle', input.uid, input.taskId, input.chargedMicroPoints].join(':')
    if (this.#hasOperation(input.idempotencyKey, fingerprint))
      return
    if (!Number.isSafeInteger(input.chargedMicroPoints) || input.chargedMicroPoints < 0)
      throw new TypeError('chargedMicroPoints must be a non-negative safe integer')

    const account = this.#getOrCreate(input.uid)
    if (account.activeTask !== input.taskId)
      throw new Error('Task does not own the active AI point reservation')
    if (input.chargedMicroPoints > account.reservedMicroPoints)
      throw new Error('Charged AI points exceed the active reservation')

    account.availableMicroPoints += account.reservedMicroPoints - input.chargedMicroPoints
    account.chargedMicroPoints = (account.chargedMicroPoints ?? 0) + input.chargedMicroPoints
    account.reservedMicroPoints = 0
    delete account.activeTask
    this.#operations.set(input.idempotencyKey, fingerprint)
  }

  async release(input: ReleaseAiPointsInput): Promise<void> {
    const fingerprint = ['release', input.uid, input.taskId].join(':')
    if (this.#hasOperation(input.idempotencyKey, fingerprint))
      return

    const account = this.#getOrCreate(input.uid)
    if (account.activeTask !== input.taskId)
      throw new Error('Task does not own the active AI point reservation')
    account.availableMicroPoints += account.reservedMicroPoints
    account.reservedMicroPoints = 0
    delete account.activeTask
    this.#operations.set(input.idempotencyKey, fingerprint)
  }

  #getOrCreate(uid: string): AiPointAccount {
    const existing = this.#accounts.get(uid)
    if (existing)
      return existing

    const account: AiPointAccount = {
      uid,
      availableMicroPoints: 1_000_000,
      reservedMicroPoints: 0,
      chargedMicroPoints: 0,
    }
    this.#accounts.set(uid, account)
    return account
  }

  #hasOperation(idempotencyKey: string, fingerprint: string): boolean {
    const prior = this.#operations.get(idempotencyKey)
    if (!prior)
      return false
    if (prior !== fingerprint)
      throw new Error('AI point idempotency conflict')
    return true
  }
}

export interface FakeRuntimeOptions {
  now?: number
}

export function createFakeRuntimeDependencies(options: FakeRuntimeOptions = {}): RuntimeDependencies {
  const pricing = createBetaPricingSnapshot({
    version: 'pricing_fixture_v1',
    billingUnit: 1,
    inputMicroCnyPerUnit: 1,
    outputMicroCnyPerUnit: 1,
    cachedInputMicroCnyPerUnit: 1,
    reasoningMicroCnyPerUnit: 1,
  })
  const disabledPolicy = createDefaultRuntimePolicy({
    version: 'policy_fixture_v1',
    model: 'fake-model',
    pricing,
  })
  const policy = {
    ...disabledPolicy,
    enabled: true,
    modelEnabled: true,
    capabilities: Object.fromEntries(
      Object.keys(disabledPolicy.capabilities).map(id => [id, true]),
    ) as typeof disabledPolicy.capabilities,
  }

  return {
    clock: new FixedClock(options.now ?? 1_723_599_000_000),
    ids: new SequentialIdGenerator(),
    auth: new FakeAuthVerifier(),
    accountApi: new InMemoryAccountApi(),
    tasks: new InMemoryTaskRepository(),
    usage: new InMemoryUsageRepository(),
    runtimeControl: new InMemoryRuntimeControlRepository(policy),
    modelExecutor: new FakeModelExecutor(),
    capabilities: createServerCapabilityRegistry(),
  }
}
