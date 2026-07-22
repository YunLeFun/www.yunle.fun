import { describe, expect, it } from 'vitest'

import {
  ACCOUNT_RESTRICTION_AUDIT_COLLECTION,
  ACCOUNT_RESTRICTIONS_COLLECTION,
  banAccount,
  expireAccountRestrictions,
  unbanAccount,
} from '../../cloudfunctions/account-api/account-restrictions.js'
import {
  handleAdminBanAccount,
  handleAdminUnbanAccount,
} from '../../cloudfunctions/account-api/internal.js'
import { USER_PROFILES_COLLECTION } from '../../cloudfunctions/account-api/profiles.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = Date.UTC(2026, 6, 23, 1)
const TOKEN = 'admin-account-restriction-token'

function db(profile = {}) {
  return makeFakeDb({
    [USER_PROFILES_COLLECTION]: [{ _id: 'u1', login: 'alice', ...profile }],
    [ACCOUNT_RESTRICTIONS_COLLECTION]: [],
    [ACCOUNT_RESTRICTION_AUDIT_COLLECTION]: [],
  })
}

function banInput(extra = {}) {
  return {
    userId: 'u1',
    reasonCode: 'abuse',
    publicReason: '违反社区行为规范',
    internalNote: '内部证据引用 SEC-123，仅管理员可见',
    expiresAt: NOW + 30 * 24 * 60 * 60 * 1000,
    appealUrl: '/docs/contact?topic=appeal',
    operator: 'owner',
    requestId: 'ban-request-001',
    now: NOW,
    ...extra,
  }
}

describe('account restriction lifecycle', () => {
  it('创建限时封禁、案件编号和不可变审计记录', async () => {
    const target = db()

    const result = await banAccount(target, banInput())

    expect(result).toMatchObject({
      status: 'active',
      type: 'admin_ban',
      reasonCode: 'abuse',
      publicReason: '违反社区行为规范',
      permanent: false,
      expiresAt: NOW + 30 * 24 * 60 * 60 * 1000,
      caseId: expect.stringMatching(/^BAN-20260723-[A-F0-9]{8}$/),
    })
    expect(target._store[ACCOUNT_RESTRICTIONS_COLLECTION][0]).toMatchObject({
      _id: 'u1',
      internalNote: '内部证据引用 SEC-123，仅管理员可见',
      createdBy: 'owner',
      status: 'active',
    })
    expect(target._store[ACCOUNT_RESTRICTION_AUDIT_COLLECTION]).toEqual([
      expect.objectContaining({ action: 'ban', userId: 'u1', operator: 'owner', caseId: result.caseId }),
    ])
  })

  it('相同 requestId 幂等重放，不重复审计', async () => {
    const target = db()
    const first = await banAccount(target, banInput())
    const replay = await banAccount(target, banInput({ now: NOW + 1 }))

    expect(replay).toMatchObject({ caseId: first.caseId, deduped: true })
    expect(target._store[ACCOUNT_RESTRICTION_AUDIT_COLLECTION]).toHaveLength(1)
  })

  it('解封保留案件和审计历史，并立即恢复业务访问', async () => {
    const target = db()
    const banned = await banAccount(target, banInput())

    const result = await unbanAccount(target, {
      userId: 'u1',
      reason: '申诉通过',
      operator: 'owner',
      requestId: 'unban-request-001',
      now: NOW + 1,
    })

    expect(result).toMatchObject({ status: 'revoked', caseId: banned.caseId })
    expect(target._store[ACCOUNT_RESTRICTION_AUDIT_COLLECTION]).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'unban', reason: '申诉通过', caseId: banned.caseId }),
    ]))
  })

  it('到期任务只解除管理员封禁', async () => {
    const target = db()
    await banAccount(target, banInput({ expiresAt: NOW + 1 }))
    target._store[ACCOUNT_RESTRICTIONS_COLLECTION].push({
      _id: 'test-identity',
      type: 'managed_test_identity',
      status: 'active',
      expiresAt: NOW,
    })

    await expect(expireAccountRestrictions(target, { now: NOW + 1 })).resolves.toMatchObject({ expired: 1 })
    expect(target._store[ACCOUNT_RESTRICTIONS_COLLECTION].find(row => row._id === 'u1')).toMatchObject({ status: 'expired' })
    expect(target._store[ACCOUNT_RESTRICTIONS_COLLECTION].find(row => row._id === 'test-identity')).toMatchObject({ status: 'active' })
  })

  it('拒绝给注销中的账号叠加封禁', async () => {
    const target = db({
      deletionStatus: 'pending',
      deletionScheduledAt: NOW + 1_000,
    })
    await expect(banAccount(target, banInput())).rejects.toThrow(/注销/)
  })

  it('拒绝把受管测试身份误当成正式账号封禁', async () => {
    const target = db()
    target._store.test_identities = [{ _id: 'managed-1', uid: 'u1', synthetic: true }]

    await expect(banAccount(target, banInput())).rejects.toThrow(/测试身份/)
  })

  it('管理 action 强制私有服务令牌并校验原因、期限', async () => {
    const target = db()
    await expect(handleAdminBanAccount(target, {
      ...banInput(),
      serviceToken: 'wrong',
    }, { expectedToken: TOKEN, now: NOW })).rejects.toThrow(/鉴权失败/)
    await expect(handleAdminBanAccount(target, {
      ...banInput({ publicReason: '', serviceToken: TOKEN }),
    }, { expectedToken: TOKEN, now: NOW })).rejects.toThrow(/公开原因/)
    await expect(handleAdminBanAccount(target, {
      ...banInput({ expiresAt: NOW, serviceToken: TOKEN }),
    }, { expectedToken: TOKEN, now: NOW })).rejects.toThrow(/期限/)
  })

  it('管理 action 可封禁并解封', async () => {
    const target = db()
    await handleAdminBanAccount(target, {
      ...banInput(),
      serviceToken: TOKEN,
    }, { expectedToken: TOKEN, now: NOW })
    await expect(handleAdminUnbanAccount(target, {
      serviceToken: TOKEN,
      userId: 'u1',
      reason: '人工复核通过',
      operator: 'owner',
      requestId: 'unban-001',
    }, { expectedToken: TOKEN, now: NOW + 1 })).resolves.toMatchObject({ status: 'revoked' })
  })
})
