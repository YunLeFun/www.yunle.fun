import type { AgentCapabilityId, JsonValue } from '../contracts/v1.js'
import type { RuntimeDependencies } from '../dependencies.js'
import type { TokenUsageBuckets } from '../domain/pricing.js'
import type { RuntimeTaskRecord } from '../domain/task.js'
import { createHash } from 'node:crypto'
import { assertRuntimePolicyAllows, PlatformBudgetService } from '../domain/budget.js'
import { calculateAuthorizationCeilings } from '../domain/pricing.js'
import { isTerminalTaskStatus, patchTask, TASK_RETENTION_MS, TaskIdempotencyConflictError, transitionTask } from '../domain/task.js'

export interface CreateRuntimeTaskInput {
  uid: string
  appId: string
  capability: AgentCapabilityId
  input: JsonValue
  projectId?: string
  projectRevision?: string
  maxUsage: TokenUsageBuckets
  maxAutomaticAttempts: number
  idempotencyKey?: string
  requestHash?: string
}

function idempotentTaskId(uid: string, idempotencyKey: string): string {
  const digest = createHash('sha256')
    .update(JSON.stringify(['advjs-ai-task', uid, idempotencyKey]))
    .digest('hex')
    .slice(0, 24)
  return `task_${digest}`
}

function assertIdempotentReplay(
  task: RuntimeTaskRecord,
  idempotencyKey: string,
  requestHash: string,
): RuntimeTaskRecord {
  if (task.clientRequestId !== idempotencyKey || task.requestHash !== requestHash)
    throw new TaskIdempotencyConflictError()
  return task
}

export class RuntimeTaskService {
  readonly #budget: PlatformBudgetService

  constructor(private readonly dependencies: RuntimeDependencies) {
    this.#budget = new PlatformBudgetService(dependencies.runtimeControl, dependencies.clock)
  }

  async create(input: CreateRuntimeTaskInput): Promise<RuntimeTaskRecord> {
    const now = this.dependencies.clock.now()
    if ((input.idempotencyKey && !input.requestHash) || (!input.idempotencyKey && input.requestHash))
      throw new TypeError('idempotencyKey and requestHash must be provided together')
    const taskId = input.idempotencyKey
      ? idempotentTaskId(input.uid, input.idempotencyKey)
      : this.dependencies.ids.generate('task')
    if (input.idempotencyKey && input.requestHash) {
      const existing = await this.dependencies.tasks.get(taskId)
      if (existing)
        return assertIdempotentReplay(existing, input.idempotencyKey, input.requestHash)
    }

    const policy = await this.dependencies.runtimeControl.getActivePolicy()
    if (!policy)
      throw new Error('AI runtime policy is unavailable')
    assertRuntimePolicyAllows(policy, input.capability)

    const ceilings = calculateAuthorizationCeilings({
      maxAutomaticAttempts: input.maxAutomaticAttempts,
      maxUsage: input.maxUsage,
      pricing: policy.pricing,
    })
    const capability = this.dependencies.capabilities.get(input.capability)
    if (!capability)
      throw new Error(`Capability is not registered: ${input.capability}`)
    const taskRecord: RuntimeTaskRecord = {
      id: taskId,
      uid: input.uid,
      appId: input.appId,
      ...(input.idempotencyKey ? { clientRequestId: input.idempotencyKey } : {}),
      ...(input.requestHash ? { requestHash: input.requestHash } : {}),
      capability: input.capability,
      input: input.input,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(input.projectRevision ? { projectRevision: input.projectRevision } : {}),
      status: 'authorizing',
      billingStatus: 'none',
      reservedMicroPoints: ceilings.userReserveMicroPoints,
      chargedMicroPoints: 0,
      providerCostMicroCny: 0,
      maxAutomaticAttempts: input.maxAutomaticAttempts,
      promptVersion: capability.promptVersion,
      parserVersion: capability.parserVersion,
      safetyVersion: capability.safetyVersion,
      executorVersion: capability.executorVersion,
      executor: capability.executor,
      policyVersion: policy.version,
      providerGroup: policy.providerGroup,
      model: policy.model,
      pricing: policy.pricing,
      platformReservedProviderCostMicroCny: ceilings.platformReserveMicroCny,
      streamText: '',
      streamRevision: 0,
      attempt: 0,
      createdAt: now,
      expiresAt: now + TASK_RETENTION_MS,
      updatedAt: now,
      version: 0,
    }
    try {
      await this.dependencies.tasks.create(taskRecord)
    }
    catch (error) {
      if (input.idempotencyKey && input.requestHash) {
        const existing = await this.dependencies.tasks.get(taskId)
        if (existing)
          return assertIdempotentReplay(existing, input.idempotencyKey, input.requestHash)
      }
      throw error
    }

    let accountReserved = false
    let budgetDateKey: string | undefined
    try {
      await this.dependencies.accountApi.reserve({
        uid: input.uid,
        taskId,
        microPoints: ceilings.userReserveMicroPoints,
        idempotencyKey: `task:${taskId}:points:reserve`,
      })
      accountReserved = true
      const budget = await this.#budget.reserve({
        taskId,
        singleAttemptMaxMicroCny: ceilings.singleAttemptProviderCostMicroCny,
        maxAutomaticAttempts: input.maxAutomaticAttempts,
        capMicroCny: policy.globalDailyProviderCapMicroCny,
        idempotencyKey: `task:${taskId}:budget:reserve`,
      })
      budgetDateKey = budget.dateKey

      return this.dependencies.tasks.update(taskId, task => transitionTask(task, 'queued', this.dependencies.clock.now(), {
        billingStatus: 'reserved',
        platformBudgetDateKey: budget.dateKey,
      }))
    }
    catch (error) {
      let cleanupUncertain = false
      if (budgetDateKey) {
        try {
          await this.#budget.release({
            taskId,
            dateKey: budgetDateKey,
            idempotencyKey: `task:${taskId}:budget:authorization-release`,
          })
        }
        catch {
          cleanupUncertain = true
        }
      }
      if (accountReserved) {
        try {
          await this.dependencies.accountApi.release({
            uid: input.uid,
            taskId,
            idempotencyKey: `task:${taskId}:points:authorization-release`,
          })
        }
        catch {
          cleanupUncertain = true
        }
      }
      await this.dependencies.tasks.update(taskId, task => transitionTask(
        task,
        cleanupUncertain ? 'reconcile_required' : 'failed',
        this.dependencies.clock.now(),
        {
          billingStatus: cleanupUncertain
            ? 'reconcile_required'
            : (accountReserved ? 'released' : 'none'),
          errorCode: cleanupUncertain ? 'AUTHORIZATION_RECONCILE_REQUIRED' : 'AUTHORIZATION_FAILED',
        },
      ))
      throw error
    }
  }

  async cancel(taskId: string): Promise<RuntimeTaskRecord> {
    const current = await this.dependencies.tasks.get(taskId)
    if (!current)
      throw new Error(`Task does not exist: ${taskId}`)
    if (isTerminalTaskStatus(current.status))
      return current

    const requested = await this.dependencies.tasks.update(taskId, task => patchTask(task, this.dependencies.clock.now(), {
      cancelRequestedAt: task.cancelRequestedAt ?? this.dependencies.clock.now(),
    }))
    if (requested.status !== 'queued')
      return requested

    try {
      await this.dependencies.accountApi.release({
        uid: requested.uid,
        taskId,
        idempotencyKey: `task:${taskId}:points:cancel-release`,
      })
      if (!requested.platformBudgetDateKey)
        throw new Error('Task platform budget date is missing')
      await this.#budget.release({
        taskId,
        dateKey: requested.platformBudgetDateKey,
        idempotencyKey: `task:${taskId}:budget:cancel-release`,
      })
      return this.dependencies.tasks.update(taskId, task => transitionTask(task, 'cancelled', this.dependencies.clock.now(), {
        billingStatus: 'released',
        completedAt: this.dependencies.clock.now(),
      }))
    }
    catch {
      await this.dependencies.tasks.update(taskId, task => transitionTask(task, 'settling', this.dependencies.clock.now(), {
        errorCode: 'CANCELLATION_RELEASE_UNCERTAIN',
      }))
      return this.dependencies.tasks.update(taskId, task => transitionTask(task, 'reconcile_required', this.dependencies.clock.now(), {
        billingStatus: 'reconcile_required',
      }))
    }
  }
}
