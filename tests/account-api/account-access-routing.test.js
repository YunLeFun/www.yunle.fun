import { describe, expect, it, vi } from 'vitest'

import { dispatchAuthenticatedAction } from '../../cloudfunctions/account-api/account-routing.js'
import { USER_PROFILES_COLLECTION } from '../../cloudfunctions/account-api/profiles.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = 1_700_000_000_000

function pendingDb() {
  return makeFakeDb({
    [USER_PROFILES_COLLECTION]: [{
      _id: 'u1',
      login: 'alice',
      deletionStatus: 'pending',
      deletionRequestedAt: NOW - 1_000,
      deletionScheduledAt: NOW + 60_000,
    }],
    account_restrictions: [],
  })
}

describe('account-api 受限账号路由', () => {
  it('待注销账号可读取统一访问状态，但业务动作在进入处理器前被拒绝', async () => {
    const db = pendingDb()
    const signIn = vi.fn(async () => ({ reward: 1 }))

    await expect(dispatchAuthenticatedAction(db, {
      userId: 'u1',
      action: 'getAccountAccessStatus',
      now: NOW,
      handlers: {},
    })).resolves.toMatchObject({ state: 'deletion_pending', recoverable: true })

    await expect(dispatchAuthenticatedAction(db, {
      userId: 'u1',
      action: 'signIn',
      now: NOW,
      handlers: { signIn },
    })).rejects.toMatchObject({ code: 'account_deletion_pending' })
    expect(signIn).not.toHaveBeenCalled()
  })

  it('冷静期内可明确恢复，且不会因普通登录动作自动恢复', async () => {
    const db = pendingDb()
    const getAccount = vi.fn(async () => ({ balance: 100 }))
    const cancelAccountDeletion = vi.fn(async () => ({ status: 'none' }))

    await expect(dispatchAuthenticatedAction(db, {
      userId: 'u1',
      action: 'getAccount',
      now: NOW,
      handlers: { getAccount },
    })).rejects.toMatchObject({ code: 'account_deletion_pending' })
    expect(db._store[USER_PROFILES_COLLECTION][0].deletionStatus).toBe('pending')

    await expect(dispatchAuthenticatedAction(db, {
      userId: 'u1',
      action: 'cancelAccountDeletion',
      now: NOW,
      handlers: { cancelAccountDeletion },
    })).resolves.toMatchObject({ status: 'none' })
    expect(cancelAccountDeletion).toHaveBeenCalledOnce()
  })
})
