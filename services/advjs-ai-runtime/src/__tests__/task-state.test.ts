import { describe, expect, it } from 'vitest'
import { transitionTask } from '../domain/task.js'
import { InMemoryTaskRepository } from '../repositories/in-memory.js'

describe('durable task state and leases', () => {
  it('allows only declared state transitions', () => {
    const authorizing = { id: 'task_fixture_001', status: 'authorizing' as const, uid: 'uid_fixture_001' }
    const queued = transitionTask(authorizing, 'queued', 20)
    const running = transitionTask(queued, 'running', 30)
    const settling = transitionTask(running, 'settling', 40)
    const completed = transitionTask(settling, 'completed', 50)

    expect(completed.status).toBe('completed')
    expect(() => transitionTask(completed, 'running', 60)).toThrowError(/invalid task transition/i)
  })

  it('claims a queued task once and uses compare-and-set lease ownership', async () => {
    const repository = new InMemoryTaskRepository()
    await repository.create({
      id: 'task_fixture_001',
      status: 'queued',
      uid: 'uid_fixture_001',
      version: 1,
    })

    const claims = await Promise.all([
      repository.claimNext({ leaseDurationMs: 10_000, leaseOwner: 'worker_a', now: 100 }),
      repository.claimNext({ leaseDurationMs: 10_000, leaseOwner: 'worker_b', now: 100 }),
    ])
    const claimed = claims.find(Boolean)

    expect(claims.filter(Boolean)).toHaveLength(1)
    expect(claimed).toMatchObject({
      attempt: 1,
      leaseExpiresAt: 10_100,
      status: 'running',
    })
    await expect(repository.renewLease({
      leaseDurationMs: 10_000,
      leaseOwner: 'wrong_owner',
      now: 200,
      taskId: 'task_fixture_001',
    })).resolves.toBe(false)
    await expect(repository.renewLease({
      leaseDurationMs: 10_000,
      leaseOwner: claimed?.leaseOwner ?? '',
      now: 200,
      taskId: 'task_fixture_001',
    })).resolves.toBe(true)
  })

  it('recovers an expired running lease without changing the stable attempt number', async () => {
    const repository = new InMemoryTaskRepository()
    await repository.create({
      attempt: 2,
      id: 'task_fixture_001',
      leaseExpiresAt: 99,
      leaseOwner: 'worker_dead',
      status: 'running',
      uid: 'uid_fixture_001',
      version: 3,
    })

    await expect(repository.claimNext({
      leaseDurationMs: 1_000,
      leaseOwner: 'worker_recovery',
      now: 100,
    })).resolves.toMatchObject({
      attempt: 2,
      leaseExpiresAt: 1_100,
      leaseOwner: 'worker_recovery',
      status: 'running',
    })
  })
})
