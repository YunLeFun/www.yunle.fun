import type { CapabilityCandidate } from '../capabilities/registry.js'
import type { AgentTaskStatus } from '../contracts/v1.js'
import type { RuntimeDependencies } from '../dependencies.js'
import type { RuntimeTaskRecord, RuntimeUsageRecord, UsageBillingResponsibility, UsageOutcome } from '../domain/task.js'
import type { ModelExecutionResult, ModelUsage } from '../executors/types.js'
import { CapabilityInputError, CapabilityOutputError, CapabilitySafetyError } from '../capabilities/errors.js'
import { readStoredCapabilityRequest } from '../capabilities/server-registry.js'
import { PlatformBudgetService } from '../domain/budget.js'
import { calculateUsageCharge } from '../domain/pricing.js'
import { patchTask, transitionTask } from '../domain/task.js'
import { ModelExecutionError, ModelExecutionUncertainError } from '../executors/errors.js'

export interface RuntimeWorkerOptions {
  owner: string
  leaseDurationMs: number
}

interface AttemptAccounting {
  providerCostMicroCny: number
  userChargeMicroPoints: number
  usage?: ModelUsage
  providerRequestId?: string
}

function requireTaskExecutionFields(task: RuntimeTaskRecord) {
  if (!task.capability || task.input === undefined || !task.appId || !task.pricing || !task.providerGroup || !task.model)
    throw new Error(`Task execution fields are incomplete: ${task.id}`)
  if (!task.platformBudgetDateKey)
    throw new Error(`Task platform budget date is missing: ${task.id}`)
  return {
    appId: task.appId,
    capability: task.capability,
    input: task.input,
    model: task.model,
    pricing: task.pricing,
    providerGroup: task.providerGroup,
    platformBudgetDateKey: task.platformBudgetDateKey,
  }
}

function clearTaskLease(task: RuntimeTaskRecord): RuntimeTaskRecord {
  const cleared = { ...task }
  delete cleared.leaseOwner
  delete cleared.leaseExpiresAt
  return cleared
}

export class RuntimeWorker {
  readonly #budget: PlatformBudgetService

  constructor(
    private readonly dependencies: RuntimeDependencies,
    private readonly options: RuntimeWorkerOptions,
  ) {
    this.#budget = new PlatformBudgetService(dependencies.runtimeControl, dependencies.clock)
  }

  async runOnce(): Promise<boolean> {
    const task = await this.dependencies.tasks.claimNext({
      leaseOwner: this.options.owner,
      leaseDurationMs: this.options.leaseDurationMs,
      now: this.dependencies.clock.now(),
    })
    if (!task)
      return false

    const attempt = task.attempt ?? 1
    const confirmedUsage = await this.dependencies.usage.getAttempt(task.id, attempt)
    if (confirmedUsage) {
      await this.#enterReconcile(task, 'CONFIRMED_ATTEMPT_RECOVERY_REQUIRED')
      return true
    }
    if (task.cancelRequestedAt) {
      await this.#finishWithoutUserCharge(task, 0, 'cancelled')
      return true
    }

    try {
      let result: ModelExecutionResult
      try {
        result = await this.#executeWithLeaseRenewal(task, attempt)
      }
      catch (error) {
        if (error instanceof ModelExecutionUncertainError) {
          if (error.usage) {
            const accounting = this.#calculateAccounting(task, error.usage, error.requestId)
            await this.#appendUsage(task, accounting, 'pending', 'error')
          }
          await this.#enterReconcile(await this.#getRequiredTask(task.id), 'MODEL_EXECUTION_UNCERTAIN')
          return true
        }
        if (!(error instanceof ModelExecutionError))
          throw error
        const accounting = this.#calculateAccounting(task, error.usage, error.requestId)
        await this.#appendUsage(task, accounting, 'platform', error.retryable ? 'retry' : 'error')
        if (error.retryable)
          await this.#retryOrFail(task, accounting.providerCostMicroCny, 'MODEL_RETRY_EXHAUSTED')
        else
          await this.#finishWithoutUserCharge(task, accounting.providerCostMicroCny, 'failed')
        return true
      }

      const accounting = this.#calculateAccounting(task, result.usage, result.requestId)
      const fields = requireTaskExecutionFields(task)
      const definition = this.dependencies.capabilities.get(fields.capability)
      if (!definition)
        throw new Error(`Capability is not registered: ${fields.capability}`)
      let candidate: CapabilityCandidate
      try {
        const stored = readStoredCapabilityRequest(fields.input)
        const request = definition.normalizeRequest(stored.input, stored.project)
        definition.assertInputSafe(request)
        candidate = await definition.parseCandidate(result.streamText, request)
      }
      catch (error) {
        if (error instanceof CapabilitySafetyError) {
          await this.#appendUsage(task, accounting, 'platform', 'blocked')
          await this.#finishWithoutUserCharge(task, accounting.providerCostMicroCny, 'blocked', error.code)
          return true
        }
        if (error instanceof CapabilityInputError || error instanceof CapabilityOutputError) {
          await this.#appendUsage(task, accounting, 'platform', 'error')
          if (error instanceof CapabilityOutputError && error.code === 'OUTPUT_PARSE_FAILED')
            await this.#retryOrFail(task, accounting.providerCostMicroCny, error.code)
          else
            await this.#finishWithoutUserCharge(task, accounting.providerCostMicroCny, 'failed', error.code)
          return true
        }
        throw error
      }

      const latest = await this.#getRequiredTask(task.id)

      if (latest.cancelRequestedAt) {
        await this.#appendUsage(task, accounting, 'user', 'cancelled')
        await this.#finishWithUserCharge(task, accounting, 'cancelled', candidate)
        return true
      }

      if (!candidate.streamText.trim()) {
        await this.#appendUsage(task, accounting, 'platform', 'error')
        await this.#retryOrFail(task, accounting.providerCostMicroCny, 'EMPTY_CANDIDATE')
        return true
      }

      await this.#appendUsage(task, accounting, 'user', 'success')
      await this.#finishWithUserCharge(task, accounting, 'completed', candidate)
      return true
    }
    catch {
      await this.#enterReconcile(await this.#getRequiredTask(task.id), 'EXECUTION_OR_USAGE_UNCERTAIN')
      return true
    }
  }

  async #executeWithLeaseRenewal(task: RuntimeTaskRecord, attempt: number): Promise<ModelExecutionResult> {
    const fields = requireTaskExecutionFields(task)
    const definition = this.dependencies.capabilities.get(fields.capability)
    if (!definition)
      throw new Error(`Capability is not registered: ${fields.capability}`)
    const stored = readStoredCapabilityRequest(fields.input)
    const normalized = definition.normalizeRequest(stored.input, stored.project)
    definition.assertInputSafe(normalized)
    const prompt = definition.buildPrompt(normalized)
    const abortController = new AbortController()
    let bufferedText = ''
    let pendingHighSurrogate = ''
    const onTextDelta = (chunk: string): Promise<void> => {
      if (!chunk)
        return Promise.resolve()
      let delta = `${pendingHighSurrogate}${chunk}`
      pendingHighSurrogate = ''
      const last = delta.charCodeAt(delta.length - 1)
      if (last >= 0xD800 && last <= 0xDBFF) {
        pendingHighSurrogate = delta.at(-1) ?? ''
        delta = delta.slice(0, -1)
      }
      bufferedText += delta
      return Promise.resolve()
    }
    const intervalMs = Math.max(1_000, Math.floor(this.options.leaseDurationMs / 3))
    const renewal = setInterval(async () => {
      try {
        const current = await this.dependencies.tasks.get(task.id)
        if (current?.cancelRequestedAt) {
          abortController.abort(new Error('Task cancellation requested'))
          return
        }
        const renewed = await this.dependencies.tasks.renewLease({
          taskId: task.id,
          leaseOwner: this.options.owner,
          leaseDurationMs: this.options.leaseDurationMs,
          now: this.dependencies.clock.now(),
        })
        if (!renewed)
          abortController.abort(new Error('Task lease ownership was lost'))
      }
      catch (error) {
        abortController.abort(error)
      }
    }, intervalMs)
    renewal.unref()

    try {
      const result = await this.dependencies.modelExecutor.execute({
        taskId: task.id,
        attempt,
        capability: fields.capability,
        input: fields.input,
        providerGroup: fields.providerGroup,
        model: fields.model,
        prompt,
        temperatureMilli: definition.temperatureMilli,
        timeoutMs: definition.timeoutMs,
        signal: abortController.signal,
        onTextDelta,
      })
      bufferedText += pendingHighSurrogate
      return result.streamText
        ? result
        : { ...result, streamText: bufferedText }
    }
    finally {
      clearInterval(renewal)
    }
  }

  #calculateAccounting(
    task: RuntimeTaskRecord,
    usage: ModelUsage | undefined,
    providerRequestId: string | undefined,
  ): AttemptAccounting {
    if (!usage) {
      return {
        providerCostMicroCny: 0,
        userChargeMicroPoints: 0,
        ...(providerRequestId ? { providerRequestId } : {}),
      }
    }
    if (!task.pricing)
      throw new Error(`Task pricing is missing: ${task.id}`)
    const charge = calculateUsageCharge(usage, task.pricing)
    return {
      providerCostMicroCny: charge.providerCostMicroCny,
      userChargeMicroPoints: charge.userChargeMicroPoints,
      usage,
      ...(providerRequestId ? { providerRequestId } : {}),
    }
  }

  async #appendUsage(
    task: RuntimeTaskRecord,
    accounting: AttemptAccounting,
    billingResponsibility: UsageBillingResponsibility,
    outcome: UsageOutcome,
  ): Promise<void> {
    const fields = requireTaskExecutionFields(task)
    const record: RuntimeUsageRecord = {
      taskId: task.id,
      uid: task.uid,
      appId: fields.appId,
      capability: fields.capability,
      attempt: task.attempt ?? 1,
      providerGroup: fields.providerGroup,
      model: fields.model,
      pricing: fields.pricing,
      providerCostMicroCny: accounting.providerCostMicroCny,
      userChargeMicroPoints: billingResponsibility === 'user' ? accounting.userChargeMicroPoints : 0,
      billingResponsibility,
      outcome,
      createdAt: this.dependencies.clock.now(),
      ...(accounting.providerRequestId ? { providerRequestId: accounting.providerRequestId } : {}),
      ...(accounting.usage ? { usage: accounting.usage } : {}),
    }
    await this.dependencies.usage.append(record)
  }

  async #retryOrFail(
    task: RuntimeTaskRecord,
    attemptProviderCostMicroCny: number,
    errorCode: string,
  ): Promise<void> {
    const providerCostMicroCny = (task.providerCostMicroCny ?? 0) + attemptProviderCostMicroCny
    if ((task.attempt ?? 1) < (task.maxAutomaticAttempts ?? 1)) {
      await this.dependencies.tasks.update(task.id, current => clearTaskLease(transitionTask(current, 'queued', this.dependencies.clock.now(), {
        providerCostMicroCny,
        errorCode,
        streamText: '',
        streamRevision: (current.streamRevision ?? 0) + (current.streamText ? 1 : 0),
      })))
      return
    }
    await this.#finishWithoutUserCharge(task, attemptProviderCostMicroCny, 'failed', errorCode)
  }

  async #finishWithUserCharge(
    task: RuntimeTaskRecord,
    accounting: AttemptAccounting,
    terminalStatus: 'completed' | 'cancelled',
    candidate: CapabilityCandidate,
  ): Promise<void> {
    const providerCostMicroCny = (task.providerCostMicroCny ?? 0) + accounting.providerCostMicroCny
    await this.dependencies.tasks.update(task.id, (current) => {
      const streamChanged = (current.streamText ?? '') !== candidate.streamText
      return clearTaskLease(transitionTask(current, 'settling', this.dependencies.clock.now(), {
        providerCostMicroCny,
        ...(candidate.proposal ? { proposal: candidate.proposal } : {}),
        ...(streamChanged
          ? {
              streamText: candidate.streamText,
              streamRevision: (current.streamRevision ?? 0) + 1,
            }
          : {}),
      }))
    })

    try {
      await this.dependencies.accountApi.settle({
        uid: task.uid,
        taskId: task.id,
        chargedMicroPoints: accounting.userChargeMicroPoints,
        idempotencyKey: `task:${task.id}:points:settle`,
      })
      await this.#settlePlatformBudget(task, providerCostMicroCny)
      await this.dependencies.tasks.update(task.id, current => transitionTask(current, terminalStatus, this.dependencies.clock.now(), {
        billingStatus: 'settled',
        chargedMicroPoints: accounting.userChargeMicroPoints,
        completedAt: this.dependencies.clock.now(),
      }))
    }
    catch {
      await this.#enterReconcile(await this.#getRequiredTask(task.id), 'SETTLEMENT_UNCERTAIN')
    }
  }

  async #finishWithoutUserCharge(
    task: RuntimeTaskRecord,
    attemptProviderCostMicroCny: number,
    terminalStatus: Extract<AgentTaskStatus, 'cancelled' | 'failed' | 'blocked'>,
    errorCode?: string,
  ): Promise<void> {
    const providerCostMicroCny = (task.providerCostMicroCny ?? 0) + attemptProviderCostMicroCny
    const current = await this.#getRequiredTask(task.id)
    if (current.status === 'running') {
      await this.dependencies.tasks.update(task.id, value => clearTaskLease(transitionTask(value, 'settling', this.dependencies.clock.now(), {
        providerCostMicroCny,
        ...(errorCode ? { errorCode } : {}),
      })))
    }

    try {
      await this.dependencies.accountApi.release({
        uid: task.uid,
        taskId: task.id,
        idempotencyKey: `task:${task.id}:points:release`,
      })
      if (providerCostMicroCny > 0)
        await this.#settlePlatformBudget(task, providerCostMicroCny)
      else
        await this.#releasePlatformBudget(task)
      await this.dependencies.tasks.update(task.id, value => transitionTask(value, terminalStatus, this.dependencies.clock.now(), {
        billingStatus: 'released',
        chargedMicroPoints: 0,
        completedAt: this.dependencies.clock.now(),
      }))
    }
    catch {
      await this.#enterReconcile(await this.#getRequiredTask(task.id), 'RELEASE_UNCERTAIN')
    }
  }

  async #settlePlatformBudget(task: RuntimeTaskRecord, providerCostMicroCny: number): Promise<void> {
    const fields = requireTaskExecutionFields(task)
    await this.#budget.settle({
      taskId: task.id,
      dateKey: fields.platformBudgetDateKey,
      actualProviderCostMicroCny: providerCostMicroCny,
      idempotencyKey: `task:${task.id}:budget:settle`,
    })
  }

  async #releasePlatformBudget(task: RuntimeTaskRecord): Promise<void> {
    const fields = requireTaskExecutionFields(task)
    await this.#budget.release({
      taskId: task.id,
      dateKey: fields.platformBudgetDateKey,
      idempotencyKey: `task:${task.id}:budget:release`,
    })
  }

  async #enterReconcile(task: RuntimeTaskRecord, errorCode: string): Promise<void> {
    if (task.status === 'reconcile_required')
      return
    if (task.status !== 'settling') {
      await this.dependencies.tasks.update(task.id, current => current.status === 'running'
        ? transitionTask(current, 'settling', this.dependencies.clock.now(), { errorCode })
        : patchTask(current, this.dependencies.clock.now(), { errorCode }))
    }
    await this.dependencies.tasks.update(task.id, current => clearTaskLease(transitionTask(current, 'reconcile_required', this.dependencies.clock.now(), {
      billingStatus: 'reconcile_required',
      errorCode,
    })))
  }

  async #getRequiredTask(taskId: string): Promise<RuntimeTaskRecord> {
    const task = await this.dependencies.tasks.get(taskId)
    if (!task)
      throw new Error(`Task does not exist: ${taskId}`)
    return task
  }
}
