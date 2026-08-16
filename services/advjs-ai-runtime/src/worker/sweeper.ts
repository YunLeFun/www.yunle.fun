import type { RuntimeDependencies } from '../dependencies.js'
import type { RuntimeTaskRecord } from '../domain/task.js'
import { PlatformBudgetService } from '../domain/budget.js'
import { patchTask, transitionTask } from '../domain/task.js'

export interface RuntimeSweeperOptions {
  staleAfterMs: number
}

export interface RuntimeSweepResult {
  leasesRecovered: number
  authorizationReleased: number
  reconcileRequired: number
  expiredDeleted: number
}

function clearTaskLease(task: RuntimeTaskRecord): RuntimeTaskRecord {
  const cleared = { ...task }
  delete cleared.leaseOwner
  delete cleared.leaseExpiresAt
  return cleared
}

export class RuntimeSweeper {
  readonly #budget: PlatformBudgetService

  constructor(
    private readonly dependencies: RuntimeDependencies,
    private readonly options: RuntimeSweeperOptions,
  ) {
    this.#budget = new PlatformBudgetService(dependencies.runtimeControl, dependencies.clock)
  }

  async sweep(): Promise<RuntimeSweepResult> {
    const now = this.dependencies.clock.now()
    const staleBefore = now - this.options.staleAfterMs
    const result: RuntimeSweepResult = {
      leasesRecovered: 0,
      authorizationReleased: 0,
      reconcileRequired: 0,
      expiredDeleted: 0,
    }

    for (const task of await this.dependencies.tasks.list()) {
      if (task.status === 'running' && (task.leaseExpiresAt ?? Number.POSITIVE_INFINITY) <= now) {
        const usage = await this.dependencies.usage.getAttempt(task.id, task.attempt ?? 1)
        if (usage) {
          await this.dependencies.tasks.update(task.id, current => transitionTask(current, 'settling', now, {
            errorCode: 'EXPIRED_LEASE_WITH_CONFIRMED_USAGE',
          }))
          await this.dependencies.tasks.update(task.id, current => clearTaskLease(transitionTask(current, 'reconcile_required', now, {
            billingStatus: 'reconcile_required',
          })))
          result.reconcileRequired += 1
        }
        else {
          await this.dependencies.tasks.update(task.id, current => clearTaskLease(transitionTask(current, 'queued', now, {
            errorCode: 'LEASE_EXPIRED_RECOVERED',
          })))
          result.leasesRecovered += 1
        }
        continue
      }

      if (task.status === 'authorizing' && (task.updatedAt ?? task.createdAt ?? now) <= staleBefore) {
        const released = await this.#releaseStaleAuthorization(task)
        if (released) {
          await this.dependencies.tasks.update(task.id, current => transitionTask(current, 'failed', now, {
            billingStatus: 'released',
            completedAt: now,
            errorCode: 'AUTHORIZATION_EXPIRED',
          }))
          result.authorizationReleased += 1
        }
        else {
          await this.dependencies.tasks.update(task.id, current => patchTask(current, now, {
            errorCode: 'AUTHORIZATION_SWEEP_RETRY',
          }))
        }
        continue
      }

      if (task.status === 'settling' && (task.updatedAt ?? now) <= staleBefore) {
        await this.dependencies.tasks.update(task.id, current => transitionTask(current, 'reconcile_required', now, {
          billingStatus: 'reconcile_required',
          errorCode: 'SETTLEMENT_SWEEP_REQUIRED',
        }))
        result.reconcileRequired += 1
        continue
      }

      if (await this.dependencies.tasks.deleteExpired(task.id, now))
        result.expiredDeleted += 1
    }

    return result
  }

  async #releaseStaleAuthorization(task: RuntimeTaskRecord): Promise<boolean> {
    try {
      const account = await this.dependencies.accountApi.getAccount(task.uid)
      if (account.activeTask === task.id) {
        await this.dependencies.accountApi.release({
          uid: task.uid,
          taskId: task.id,
          idempotencyKey: `task:${task.id}:points:sweep-release`,
        })
      }
      if (task.platformBudgetDateKey) {
        await this.#budget.release({
          taskId: task.id,
          dateKey: task.platformBudgetDateKey,
          idempotencyKey: `task:${task.id}:budget:sweep-release`,
        })
      }
      return true
    }
    catch {
      return false
    }
  }
}
