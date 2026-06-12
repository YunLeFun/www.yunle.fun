import { describe, expect, it } from 'vitest'

import { handleDeductCoinForUser } from '../../cloudfunctions/account-api/internal.js'
import { COIN_TX_COLLECTION, WALLET_COLLECTION } from '../../cloudfunctions/account-api/lib/wallet.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = 1_700_000_000_000
const TOKEN = 'test-internal-token'

describe('account-api deductCoinForUser', () => {
  it('拒绝缺失 token', async () => {
    const db = makeFakeDb({})
    await expect(handleDeductCoinForUser(db, {
      userId: 'u1',
      appId: 'wenta',
      amount: 99,
      bizId: 'wenta:pack:premarriage-full:self',
    }, { expectedToken: TOKEN, now: NOW })).rejects.toThrow(/内部服务鉴权失败/)
  })

  it('拒绝错误 token', async () => {
    const db = makeFakeDb({})
    await expect(handleDeductCoinForUser(db, {
      serviceToken: 'wrong',
      userId: 'u1',
      appId: 'wenta',
      amount: 99,
      bizId: 'wenta:pack:premarriage-full:self',
    }, { expectedToken: TOKEN, now: NOW })).rejects.toThrow(/内部服务鉴权失败/)
  })

  it('要求服务端配置 token', async () => {
    const db = makeFakeDb({})
    await expect(handleDeductCoinForUser(db, {
      serviceToken: TOKEN,
      userId: 'u1',
      appId: 'wenta',
      amount: 99,
      bizId: 'wenta:pack:premarriage-full:self',
    }, { expectedToken: '', now: NOW })).rejects.toThrow(/内部服务鉴权未配置/)
  })

  it('按指定 userId 扣云币并写入 wenta 流水', async () => {
    const db = makeFakeDb({
      [WALLET_COLLECTION]: [{ _id: 'w', userId: 'target-user', balance: 120, version: 1 }],
    })
    const res = await handleDeductCoinForUser(db, {
      serviceToken: TOKEN,
      userId: 'target-user',
      appId: 'wenta',
      amount: 99,
      bizId: 'wenta:pack:premarriage-full:self',
      meta: { packId: 'premarriage-full' },
    }, { expectedToken: TOKEN, now: NOW })

    expect(res).toEqual({ balance: 21, deduped: false })
    expect(db._store[WALLET_COLLECTION][0]).toMatchObject({ userId: 'target-user', balance: 21, version: 2 })
    expect(db._store[COIN_TX_COLLECTION][0]).toMatchObject({
      userId: 'target-user',
      appId: 'wenta',
      type: 'consume',
      amount: -99,
      balanceAfter: 21,
      refId: 'wenta:pack:premarriage-full:self',
      meta: { packId: 'premarriage-full' },
    })
  })

  it('重复 bizId 不重复扣费', async () => {
    const db = makeFakeDb({
      [WALLET_COLLECTION]: [{ _id: 'w', userId: 'u1', balance: 150, version: 1 }],
    })
    await handleDeductCoinForUser(db, {
      serviceToken: TOKEN,
      userId: 'u1',
      appId: 'wenta',
      amount: 99,
      bizId: 'wenta:pack:premarriage-full:self',
    }, { expectedToken: TOKEN, now: NOW })
    const res = await handleDeductCoinForUser(db, {
      serviceToken: TOKEN,
      userId: 'u1',
      appId: 'wenta',
      amount: 99,
      bizId: 'wenta:pack:premarriage-full:self',
    }, { expectedToken: TOKEN, now: NOW + 1 })

    expect(res).toEqual({ balance: 51, deduped: true })
    expect(db._store[WALLET_COLLECTION][0]).toMatchObject({ balance: 51, version: 2 })
    expect(db._store[COIN_TX_COLLECTION]).toHaveLength(1)
  })
})
