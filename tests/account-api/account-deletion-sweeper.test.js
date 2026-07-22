import { describe, expect, it, vi } from 'vitest'

import { USER_PROFILES_COLLECTION } from '../../cloudfunctions/account-api/profiles.js'
import { runAccountMaintenance } from '../../cloudfunctions/account-deletion-sweeper/maintenance.js'
import { createAuthAdmin, createStore, sweepDueAccountDeletions } from '../../cloudfunctions/account-deletion-sweeper/sweep.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = 1_700_000_000_000

function makeDependencies(rows) {
  const completed = []
  const events = []
  return {
    completed,
    events,
    store: {
      listDue: vi.fn(async () => rows.filter(row => row.deletionScheduledAt <= NOW)),
      markCompleted: vi.fn(async (userId) => {
        events.push(`complete:${userId}`)
        completed.push(userId)
      }),
      markFailed: vi.fn(async () => ({ failureCount: 1, shouldAlertOps: false, shouldNotifyUser: false })),
    },
    accountApi: {
      finalize: vi.fn(async (userId) => {
        events.push(`finalize:${userId}`)
        return { finalized: true, userId }
      }),
    },
    authAdmin: {
      blockUser: vi.fn(async (userId) => {
        events.push(`block:${userId}`)
        return { present: true }
      }),
      deleteUser: vi.fn(async (userId) => {
        events.push(`delete:${userId}`)
        return { deleted: true }
      }),
    },
    notifier: {
      alertOps: vi.fn(async () => undefined),
      notifyDelayed: vi.fn(async () => undefined),
      notifyCompleted: vi.fn(async () => undefined),
    },
  }
}

describe('account deletion sweeper', () => {
  it('同一定时维护会自动清理到期管理员封禁', async () => {
    const expireRestrictions = vi.fn(async () => ({ expired: 2 }))
    const sweepDeletions = vi.fn(async () => ({ scanned: 1, completed: 1, failed: 0 }))

    await expect(runAccountMaintenance({ expireRestrictions, sweepDeletions }))
      .resolves
      .toEqual({
        restrictions: { ok: true, expired: 2 },
        deletions: { scanned: 1, completed: 1, failed: 0 },
      })
    expect(expireRestrictions).toHaveBeenCalledOnce()
    expect(sweepDeletions).toHaveBeenCalledOnce()
  })

  it('封禁到期维护暂时失败不阻断到期注销清理', async () => {
    const expireRestrictions = vi.fn(async () => {
      throw new Error('temporary')
    })
    const sweepDeletions = vi.fn(async () => ({ scanned: 1, completed: 1, failed: 0 }))

    await expect(runAccountMaintenance({ expireRestrictions, sweepDeletions }))
      .resolves
      .toMatchObject({
        restrictions: { ok: false, error: 'Error' },
        deletions: { completed: 1 },
      })
  })

  it('到期注销必须删除 CloudBase Auth 身份，释放 GitHub/手机等绑定', async () => {
    const deps = makeDependencies([
      { _id: 'due', deletionScheduledAt: NOW },
      { _id: 'later', deletionScheduledAt: NOW + 1 },
    ])

    const result = await sweepDueAccountDeletions({ ...deps, now: NOW })

    expect(result).toMatchObject({ scanned: 1, completed: 1, failed: 0 })
    expect(deps.authAdmin.blockUser).toHaveBeenCalledWith('due')
    expect(deps.accountApi.finalize).toHaveBeenCalledWith('due', NOW)
    expect(deps.authAdmin.deleteUser).toHaveBeenCalledWith('due')
    expect(deps.store.markCompleted).toHaveBeenCalledWith('due', NOW)
    expect(deps.authAdmin.deleteUser).not.toHaveBeenCalledWith('later')
    expect(deps.events).toEqual(['block:due', 'finalize:due', 'delete:due', 'complete:due'])
    expect(deps.notifier.notifyCompleted).toHaveBeenCalledWith('due', NOW)
  })

  it('认证身份删除失败时保留重试状态，不误报完成', async () => {
    const deps = makeDependencies([{ _id: 'due', deletionScheduledAt: NOW }])
    deps.authAdmin.deleteUser.mockRejectedValueOnce(new Error('auth unavailable'))

    const result = await sweepDueAccountDeletions({ ...deps, now: NOW })

    expect(result).toMatchObject({ scanned: 1, completed: 0, failed: 1 })
    expect(deps.store.markCompleted).not.toHaveBeenCalled()
    expect(deps.store.markFailed).toHaveBeenCalledWith('due', NOW, expect.any(Error))
  })

  it('连续失败 3 次告警运维，超过 24 小时另行通知用户', async () => {
    const deps = makeDependencies([{ _id: 'due', deletionScheduledAt: NOW - 86_400_000 }])
    deps.authAdmin.blockUser.mockRejectedValueOnce(new Error('auth unavailable'))
    deps.store.markFailed.mockResolvedValueOnce({
      failureCount: 3,
      firstErrorAt: NOW - 86_400_000,
      shouldAlertOps: true,
      shouldNotifyUser: true,
    })

    const result = await sweepDueAccountDeletions({ ...deps, now: NOW })

    expect(result).toMatchObject({ completed: 0, failed: 1 })
    expect(deps.notifier.alertOps).toHaveBeenCalledWith('due', expect.objectContaining({ failureCount: 3 }))
    expect(deps.notifier.notifyDelayed).toHaveBeenCalledWith('due', expect.objectContaining({ failureCount: 3 }))
    expect(deps.notifier.notifyCompleted).not.toHaveBeenCalled()
  })

  it('只用现有 _id 索引分页扫描到期申请', async () => {
    const profiles = Array.from({ length: 125 }, (_, index) => ({
      _id: `u-${String(index).padStart(3, '0')}`,
      deletionStatus: index === 110 ? 'pending' : null,
      deletionScheduledAt: index === 110 ? NOW : null,
    }))
    const db = makeFakeDb({ [USER_PROFILES_COLLECTION]: profiles })

    await expect(createStore(db).listDue(NOW)).resolves.toEqual([
      expect.objectContaining({ _id: 'u-110' }),
    ])
  })

  it('auth 用户已不存在时幂等跳过，存在时先封禁再硬删', async () => {
    const user = {
      describeUserList: vi.fn()
        .mockResolvedValueOnce({ Data: { Total: 1, UserList: [{ Uid: 'u1' }] } })
        .mockResolvedValueOnce({ Data: { Total: 1, UserList: [{ Uid: 'u1' }] } })
        .mockResolvedValueOnce({ Data: { Total: 0, UserList: [] } }),
      modifyUser: vi.fn().mockResolvedValue({ Data: { Success: true } }),
      deleteUsers: vi.fn().mockResolvedValue({ Data: { SuccessCount: 1, FailedCount: 0 } }),
    }
    const authAdmin = createAuthAdmin({ user })

    await expect(authAdmin.blockUser('u1')).resolves.toEqual({ present: true })
    await expect(authAdmin.deleteUser('u1')).resolves.toEqual({ deleted: true })
    await expect(authAdmin.deleteUser('already-gone')).resolves.toEqual({ deleted: false, alreadyAbsent: true })
    expect(user.modifyUser).toHaveBeenCalledWith({ uid: 'u1', userStatus: 'BLOCKED' })
    expect(user.deleteUsers).toHaveBeenCalledWith({ uids: ['u1'] })
  })

  it('失败状态持久化计数、首次失败时间和有上限的指数退避', async () => {
    const db = makeFakeDb({
      [USER_PROFILES_COLLECTION]: [{
        _id: 'u1',
        deletionStatus: 'finalizing',
        deletionScheduledAt: NOW - 1,
      }],
    })
    const store = createStore(db)

    const first = await store.markFailed('u1', NOW, new Error('first'))
    const second = await store.markFailed('u1', NOW + 60_000, new Error('second'))
    const third = await store.markFailed('u1', NOW + 120_000, new Error('third'))

    expect(first).toMatchObject({ failureCount: 1, firstErrorAt: NOW, shouldAlertOps: false })
    expect(second).toMatchObject({ failureCount: 2, firstErrorAt: NOW, shouldAlertOps: false })
    expect(third).toMatchObject({ failureCount: 3, firstErrorAt: NOW, shouldAlertOps: true })
    expect(db._store[USER_PROFILES_COLLECTION][0]).toMatchObject({
      deletionFailureCount: 3,
      deletionFirstErrorAt: NOW,
      deletionOpsAlertedAt: NOW + 120_000,
      deletionNextRetryAt: expect.any(Number),
    })
    expect(db._store[USER_PROFILES_COLLECTION][0].deletionNextRetryAt).toBeGreaterThan(NOW + 120_000)
  })
})
