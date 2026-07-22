import { describe, expect, it } from 'vitest'

import {
  ACCOUNT_RESTRICTIONS_COLLECTION,
  AccountAccessError,
  assertAccountActionAllowed,
  getAccountAccess,
} from '../../cloudfunctions/account-api/account-access.js'
import {
  handleDeductCoinForUser,
  handleGetAccountAccessForUser,
} from '../../cloudfunctions/account-api/internal.js'
import { WALLET_COLLECTION } from '../../cloudfunctions/account-api/lib/wallet.js'
import { USER_PROFILES_COLLECTION } from '../../cloudfunctions/account-api/profiles.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = 1_700_000_000_000
const TOKEN = 'internal-account-access-token'

function dbWith({ profile = {}, restriction } = {}) {
  return makeFakeDb({
    [USER_PROFILES_COLLECTION]: [{ _id: 'u1', login: 'alice', ...profile }],
    [ACCOUNT_RESTRICTIONS_COLLECTION]: restriction ? [{ _id: 'u1', ...restriction }] : [],
  })
}

describe('account-api 统一账户访问状态', () => {
  it('注销冷静期只允许查询状态、明确恢复和退出登录', async () => {
    const db = dbWith({
      profile: {
        deletionStatus: 'pending',
        deletionRequestedAt: NOW - 1_000,
        deletionScheduledAt: NOW + 60_000,
      },
    })

    await expect(getAccountAccess(db, { userId: 'u1', now: NOW })).resolves.toMatchObject({
      state: 'deletion_pending',
      restricted: true,
      recoverable: true,
      scheduledAt: NOW + 60_000,
    })
    await expect(assertAccountActionAllowed(db, { userId: 'u1', action: 'getAccountDeletionStatus', now: NOW })).resolves.toBeUndefined()
    await expect(assertAccountActionAllowed(db, { userId: 'u1', action: 'cancelAccountDeletion', now: NOW })).resolves.toBeUndefined()

    for (const action of ['getAccount', 'signIn', 'tip', 'followUser', 'uploadAvatar']) {
      await expect(assertAccountActionAllowed(db, { userId: 'u1', action, now: NOW }))
        .rejects
        .toMatchObject({ code: 'account_deletion_pending', state: 'deletion_pending' })
    }
  })

  it('精确截止时间一到即不可恢复，即使后台尚未清理', async () => {
    const db = dbWith({
      profile: {
        deletionStatus: 'pending',
        deletionRequestedAt: NOW - 30 * 24 * 60 * 60 * 1_000,
        deletionScheduledAt: NOW,
      },
    })

    await expect(getAccountAccess(db, { userId: 'u1', now: NOW })).resolves.toMatchObject({
      state: 'deletion_finalizing',
      restricted: true,
      recoverable: false,
    })
    await expect(assertAccountActionAllowed(db, { userId: 'u1', action: 'cancelAccountDeletion', now: NOW }))
      .rejects
      .toBeInstanceOf(AccountAccessError)
  })

  it('管理员封禁只向用户返回公开原因、期限、案件编号和申诉入口', async () => {
    const db = dbWith({
      restriction: {
        type: 'admin_ban',
        status: 'active',
        reasonCode: 'abuse',
        publicReason: '违反社区行为规范',
        internalNote: '风控规则与证据不得下发',
        caseId: 'BAN-20261114-ABC123',
        appealUrl: '/docs/contact?topic=appeal',
        createdAt: NOW - 1_000,
        expiresAt: NOW + 86_400_000,
      },
    })

    const access = await getAccountAccess(db, { userId: 'u1', now: NOW })
    expect(access).toEqual({
      state: 'admin_banned',
      restricted: true,
      recoverable: false,
      reasonCode: 'abuse',
      publicReason: '违反社区行为规范',
      caseId: 'BAN-20261114-ABC123',
      appealUrl: '/docs/contact?topic=appeal',
      startedAt: NOW - 1_000,
      expiresAt: NOW + 86_400_000,
      permanent: false,
    })
    expect(JSON.stringify(access)).not.toContain('风控规则')
  })

  it('已到期封禁按服务端时间立即失效，访问路径不绕过审计写状态', async () => {
    const db = dbWith({
      restriction: {
        type: 'admin_ban',
        status: 'active',
        publicReason: '临时限制',
        caseId: 'BAN-OLD',
        createdAt: NOW - 100_000,
        expiresAt: NOW,
      },
    })

    await expect(getAccountAccess(db, { userId: 'u1', now: NOW })).resolves.toEqual({
      state: 'active',
      restricted: false,
    })
    expect(db._store[ACCOUNT_RESTRICTIONS_COLLECTION][0]).toMatchObject({
      status: 'active',
    })
    expect(db._store[ACCOUNT_RESTRICTIONS_COLLECTION][0]).not.toHaveProperty('expiredAt')
  })

  it('内部服务可读取同一份公开访问状态', async () => {
    const db = dbWith({
      profile: {
        deletionStatus: 'pending',
        deletionRequestedAt: NOW - 1_000,
        deletionScheduledAt: NOW + 60_000,
      },
    })

    await expect(handleGetAccountAccessForUser(db, {
      serviceToken: TOKEN,
      userId: 'u1',
    }, { expectedToken: TOKEN, now: NOW })).resolves.toMatchObject({
      state: 'deletion_pending',
      restricted: true,
    })
  })

  it('内部扣费也会二次拒绝受限账号且不改变余额', async () => {
    const db = makeFakeDb({
      [USER_PROFILES_COLLECTION]: [{
        _id: 'u1',
        deletionStatus: 'pending',
        deletionScheduledAt: NOW + 60_000,
      }],
      [ACCOUNT_RESTRICTIONS_COLLECTION]: [],
      [WALLET_COLLECTION]: [{ _id: 'wallet-u1', userId: 'u1', balance: 10, version: 1 }],
    })

    await expect(handleDeductCoinForUser(db, {
      serviceToken: TOKEN,
      userId: 'u1',
      appId: 'wish',
      amount: 1,
      bizId: 'wish:restricted-user',
    }, { expectedToken: TOKEN, now: NOW })).rejects.toMatchObject({
      code: 'account_deletion_pending',
    })
    expect(db._store[WALLET_COLLECTION][0].balance).toBe(10)
  })
})
