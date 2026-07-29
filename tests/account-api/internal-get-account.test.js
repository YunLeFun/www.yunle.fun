import { describe, expect, it } from 'vitest'

import { handleGetAccountForUser } from '../../cloudfunctions/account-api/internal.js'
import { MEMBERSHIPS_COLLECTION } from '../../cloudfunctions/account-api/lib/orders.js'
import { COIN_TX_COLLECTION, WALLET_COLLECTION } from '../../cloudfunctions/account-api/lib/wallet.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = 1_700_000_000_000
const TOKEN = 'test-internal-token'

describe('account-api getAccountForUser', () => {
  it('拒绝缺失 / 错误 token', async () => {
    const db = makeFakeDb({})
    await expect(handleGetAccountForUser(db, { userId: 'u1' }, { expectedToken: TOKEN, now: NOW }))
      .rejects
      .toThrow(/内部服务鉴权失败/)
    await expect(handleGetAccountForUser(db, { serviceToken: 'wrong', userId: 'u1' }, { expectedToken: TOKEN, now: NOW }))
      .rejects
      .toThrow(/内部服务鉴权失败/)
  })

  it('要求服务端配置 token', async () => {
    const db = makeFakeDb({})
    await expect(handleGetAccountForUser(db, { serviceToken: TOKEN, userId: 'u1' }, { expectedToken: '', now: NOW }))
      .rejects
      .toThrow(/内部服务鉴权未配置/)
  })

  it('拒绝缺失 userId', async () => {
    const db = makeFakeDb({})
    await expect(handleGetAccountForUser(db, { serviceToken: TOKEN }, { expectedToken: TOKEN, now: NOW }))
      .rejects
      .toThrow(/userId/)
  })

  it('无钱包无会员时余额为 0、会员未激活', async () => {
    const db = makeFakeDb({})
    const res = await handleGetAccountForUser(db, { serviceToken: TOKEN, userId: 'newbie' }, { expectedToken: TOKEN, now: NOW })
    expect(res).toEqual({ coin: 0, membership: { isActive: false, level: null, expireAt: null } })
  })

  it('返回余额与有效会员', async () => {
    const db = makeFakeDb({
      [WALLET_COLLECTION]: [{ _id: 'w', userId: 'target-user', balance: 88, version: 3 }],
      [MEMBERSHIPS_COLLECTION]: [{ _id: 'target-user', level: 'pro', expireAt: NOW + 100_000 }],
    })
    const res = await handleGetAccountForUser(db, { serviceToken: TOKEN, userId: 'target-user' }, { expectedToken: TOKEN, now: NOW })
    expect(res).toEqual({ coin: 88, membership: { isActive: true, level: 'pro', expireAt: NOW + 100_000 } })
  })

  it('兼容按 userId 保存的历史有效会员', async () => {
    const db = makeFakeDb({
      [MEMBERSHIPS_COLLECTION]: [{
        _id: 'legacy-membership',
        userId: 'legacy-user',
        planId: 'basic',
        expireAt: NOW + 100_000,
      }],
    })

    const res = await handleGetAccountForUser(
      db,
      { serviceToken: TOKEN, userId: 'legacy-user' },
      { expectedToken: TOKEN, now: NOW },
    )

    expect(res).toEqual({
      coin: 0,
      membership: {
        isActive: true,
        level: 'basic',
        expireAt: NOW + 100_000,
      },
    })
  })

  it('过期会员视为未激活', async () => {
    const db = makeFakeDb({
      [WALLET_COLLECTION]: [{ _id: 'w', userId: 'u1', balance: 10, version: 1 }],
      [MEMBERSHIPS_COLLECTION]: [{ _id: 'u1', level: 'pro', expireAt: NOW - 1 }],
    })
    const res = await handleGetAccountForUser(db, { serviceToken: TOKEN, userId: 'u1' }, { expectedToken: TOKEN, now: NOW })
    expect(res).toEqual({ coin: 10, membership: { isActive: false, level: 'pro', expireAt: NOW - 1 } })
  })

  it('只读：不改钱包、不产生流水', async () => {
    const db = makeFakeDb({
      [WALLET_COLLECTION]: [{ _id: 'w', userId: 'u1', balance: 50, version: 1 }],
    })
    await handleGetAccountForUser(db, { serviceToken: TOKEN, userId: 'u1' }, { expectedToken: TOKEN, now: NOW })
    expect(db._store[WALLET_COLLECTION][0]).toMatchObject({ balance: 50, version: 1 })
    expect(db._store[COIN_TX_COLLECTION] ?? []).toHaveLength(0)
  })
})
