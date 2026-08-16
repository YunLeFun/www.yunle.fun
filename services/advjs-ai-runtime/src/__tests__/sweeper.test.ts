import { describe, expect, it } from 'vitest'
import { createFakeRuntimeDependencies } from '../testing/fakes.js'
import { RuntimeSweeper } from '../worker/sweeper.js'

describe('runtime sweeper', () => {
  it('recovers expired leases, stale authorization reservations and stuck settlement', async () => {
    const dependencies = createFakeRuntimeDependencies({ now: 10_000 })
    await dependencies.tasks.create({
      attempt: 1,
      id: 'task_expired_lease',
      leaseExpiresAt: 9_000,
      leaseOwner: 'worker_dead',
      status: 'running',
      uid: 'uid_lease',
      updatedAt: 9_000,
    })
    await dependencies.accountApi.reserve({
      idempotencyKey: 'reserve_stale_authorizing',
      microPoints: 20,
      taskId: 'task_stale_authorizing',
      uid: 'uid_authorizing',
    })
    await dependencies.tasks.create({
      billingStatus: 'reserved',
      createdAt: 1_000,
      id: 'task_stale_authorizing',
      reservedMicroPoints: 20,
      status: 'authorizing',
      uid: 'uid_authorizing',
      updatedAt: 1_000,
    })
    await dependencies.tasks.create({
      billingStatus: 'reserved',
      id: 'task_stuck_settling',
      status: 'settling',
      uid: 'uid_settling',
      updatedAt: 1_000,
    })

    const result = await new RuntimeSweeper(dependencies, { staleAfterMs: 5_000 }).sweep()

    expect(result).toEqual({
      authorizationReleased: 1,
      expiredDeleted: 0,
      leasesRecovered: 1,
      reconcileRequired: 1,
    })
    await expect(dependencies.tasks.get('task_expired_lease')).resolves.toMatchObject({ status: 'queued' })
    await expect(dependencies.tasks.get('task_stale_authorizing')).resolves.toMatchObject({
      billingStatus: 'released',
      status: 'failed',
    })
    await expect(dependencies.accountApi.getAccount('uid_authorizing')).resolves.toMatchObject({
      availableMicroPoints: 1_000_000,
      reservedMicroPoints: 0,
    })
    await expect(dependencies.tasks.get('task_stuck_settling')).resolves.toMatchObject({
      billingStatus: 'reconcile_required',
      status: 'reconcile_required',
    })
  })

  it('deletes expired resolved task content but preserves unresolved reconciliation', async () => {
    const dependencies = createFakeRuntimeDependencies({ now: 100_000 })
    await dependencies.tasks.create({
      expiresAt: 99_999,
      id: 'task_expired_completed',
      status: 'completed',
      uid: 'uid_completed',
    })
    await dependencies.tasks.create({
      expiresAt: 99_999,
      id: 'task_expired_reconcile',
      status: 'reconcile_required',
      uid: 'uid_reconcile',
    })
    await dependencies.tasks.create({
      expiresAt: 100_001,
      id: 'task_not_expired',
      status: 'failed',
      uid: 'uid_failed',
    })

    await expect(new RuntimeSweeper(dependencies, { staleAfterMs: 5_000 }).sweep()).resolves.toMatchObject({
      expiredDeleted: 1,
    })
    await expect(dependencies.tasks.get('task_expired_completed')).resolves.toBeUndefined()
    await expect(dependencies.tasks.get('task_expired_reconcile')).resolves.toMatchObject({
      status: 'reconcile_required',
    })
    await expect(dependencies.tasks.get('task_not_expired')).resolves.toMatchObject({
      status: 'failed',
    })
  })
})
