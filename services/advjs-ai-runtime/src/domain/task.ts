import type { AgentBillingStatus, AgentCapabilityId, AgentProposal, AgentTaskStatus, JsonValue } from '../contracts/v1.js'
import type { ModelUsage } from '../executors/types.js'
import type { PricingSnapshot } from './pricing.js'

export interface RuntimeTaskRecord {
  id: string
  uid: string
  status: AgentTaskStatus
  version?: number
  appId?: string
  clientRequestId?: string
  requestHash?: string
  capability?: AgentCapabilityId
  input?: JsonValue
  projectId?: string
  projectRevision?: string
  proposal?: AgentProposal
  billingStatus?: AgentBillingStatus
  reservedMicroPoints?: number
  chargedMicroPoints?: number
  providerCostMicroCny?: number
  maxAutomaticAttempts?: number
  promptVersion?: string
  parserVersion?: string
  safetyVersion?: string
  executorVersion?: string
  executor?: 'model' | 'agent'
  policyVersion?: string
  providerGroup?: 'cloudbase'
  model?: string
  pricing?: Readonly<PricingSnapshot>
  platformBudgetDateKey?: string
  platformReservedProviderCostMicroCny?: number
  streamText?: string
  streamRevision?: number
  attempt?: number
  leaseOwner?: string
  leaseExpiresAt?: number
  cancelRequestedAt?: number
  reconcileRequestedAt?: number
  reconcileRequestedBy?: string
  reconcileServiceActor?: string
  reconcileReason?: string
  reconcileIdempotencyKey?: string
  reconcileFingerprint?: string
  createdAt?: number
  updatedAt?: number
  completedAt?: number
  expiresAt?: number
  errorCode?: string
}

export const TASK_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000

export class TaskIdempotencyConflictError extends Error {
  readonly code = 'IDEMPOTENCY_CONFLICT'

  constructor() {
    super('Task idempotency key was reused with different semantics')
  }
}

export type UsageBillingResponsibility = 'user' | 'platform' | 'pending'
export type UsageOutcome = 'success' | 'retry' | 'error' | 'cancelled' | 'blocked'

export interface RuntimeUsageRecord {
  taskId: string
  uid: string
  appId: string
  capability: AgentCapabilityId
  attempt: number
  providerGroup: 'cloudbase'
  model: string
  providerRequestId?: string
  usage?: ModelUsage
  pricing: Readonly<PricingSnapshot>
  providerCostMicroCny: number
  userChargeMicroPoints: number
  billingResponsibility: UsageBillingResponsibility
  outcome: UsageOutcome
  createdAt: number
}

const ALLOWED_TRANSITIONS: Readonly<Record<AgentTaskStatus, readonly AgentTaskStatus[]>> = {
  authorizing: ['queued', 'failed', 'reconcile_required'],
  queued: ['running', 'settling', 'cancelled', 'failed'],
  running: ['queued', 'settling'],
  settling: ['completed', 'cancelled', 'blocked', 'failed', 'reconcile_required'],
  completed: [],
  cancelled: [],
  blocked: [],
  failed: [],
  reconcile_required: [],
}

export function transitionTask(
  task: RuntimeTaskRecord,
  nextStatus: AgentTaskStatus,
  now: number,
  patch: Partial<RuntimeTaskRecord> = {},
): RuntimeTaskRecord {
  if (!ALLOWED_TRANSITIONS[task.status].includes(nextStatus))
    throw new Error(`Invalid task transition: ${task.status} -> ${nextStatus}`)

  return {
    ...task,
    ...patch,
    status: nextStatus,
    updatedAt: now,
    version: (task.version ?? 0) + 1,
  }
}

export function patchTask(
  task: RuntimeTaskRecord,
  now: number,
  patch: Partial<RuntimeTaskRecord>,
): RuntimeTaskRecord {
  return {
    ...task,
    ...patch,
    updatedAt: now,
    version: (task.version ?? 0) + 1,
  }
}

export function isTerminalTaskStatus(status: AgentTaskStatus): boolean {
  return ['completed', 'cancelled', 'blocked', 'failed', 'reconcile_required'].includes(status)
}

export function isTaskContentExpired(task: RuntimeTaskRecord, now: number): boolean {
  return task.status !== 'reconcile_required'
    && isTerminalTaskStatus(task.status)
    && task.expiresAt !== undefined
    && task.expiresAt <= now
}
