import { describe, expect, it } from 'vitest'

import { handleAdminAdjustCoin } from '../../functions/account-api/internal.js'
import { COIN_TX_COLLECTION, WALLET_COLLECTION } from '../../functions/account-api/lib/wallet.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = 1_700_000_000_000
const TOKEN = 'test-internal-token'

function base(extra) {
  return { serviceToken: TOKEN, userId: 'u1', refId: 'admin:op-1', reason: '客服补偿', operator: 'yunyoujun', ...extra }
}

describe('account-api adminAdjustCoin', () => {
  it('拒绝错误 token', async () => {
    const db = makeFakeDb({})
    await expect(handleAdminAdjustCoin(db, base({ serviceToken: 'wrong', amount: 100 }), { expectedToken: TOKEN, now: NOW }))
      .rejects
      .toThrow(/内部服务鉴权失败/)
  })

  it('拒绝 amount=0', async () => {
    const db = makeFakeDb({})
    await expect(handleAdminAdjustCoin(db, base({ amount: 0 }), { expectedToken: TOKEN, now: NOW }))
      .rejects
      .toThrow(/非 0 整数/)
  })

  it('reason 必填', async () => {
    const db = makeFakeDb({})
    await expect(handleAdminAdjustCoin(db, base({ amount: 100, reason: '' }), { expectedToken: TOKEN, now: NOW }))
      .rejects
      .toThrow(/reason 必填/)
  })

  it('refId 必填', async () => {
    const db = makeFakeDb({})
    await expect(handleAdminAdjustCoin(db, base({ amount: 100, refId: '' }), { expectedToken: TOKEN, now: NOW }))
      .rejects
      .toThrow(/refId 必填/)
  })

  it('超过单笔上限抛错', async () => {
    const db = makeFakeDb({})
    await expect(handleAdminAdjustCoin(db, base({ amount: 100_001 }), { expectedToken: TOKEN, now: NOW }))
      .rejects
      .toThrow(/单笔调账不得超过/)
  })

  it('入账（amount>0）创建钱包并写 gift 流水带 adminAdjust 标记', async () => {
    const db = makeFakeDb({})
    const res = await handleAdminAdjustCoin(db, base({ amount: 100 }), { expectedToken: TOKEN, now: NOW })

    expect(res).toEqual({ balance: 100, deduped: false })
    expect(db._store[WALLET_COLLECTION][0]).toMatchObject({ userId: 'u1', balance: 100, version: 1 })
    expect(db._store[COIN_TX_COLLECTION][0]).toMatchObject({
      userId: 'u1',
      appId: 'admin',
      type: 'gift',
      amount: 100,
      balanceAfter: 100,
      refId: 'admin:op-1',
      meta: { adminAdjust: true, reason: '客服补偿', operator: 'yunyoujun' },
    })
  })

  it('扣减（amount<0）写 consume 流水', async () => {
    const db = makeFakeDb({
      [WALLET_COLLECTION]: [{ _id: 'w', userId: 'u1', balance: 120, version: 1 }],
    })
    const res = await handleAdminAdjustCoin(db, base({ amount: -30, refId: 'admin:op-2', reason: '错充回收' }), { expectedToken: TOKEN, now: NOW })

    expect(res).toEqual({ balance: 90, deduped: false })
    expect(db._store[WALLET_COLLECTION][0]).toMatchObject({ balance: 90, version: 2 })
    expect(db._store[COIN_TX_COLLECTION][0]).toMatchObject({
      type: 'consume',
      amount: -30,
      balanceAfter: 90,
      refId: 'admin:op-2',
      meta: { adminAdjust: true, reason: '错充回收' },
    })
  })

  it('扣减超过余额抛错', async () => {
    const db = makeFakeDb({
      [WALLET_COLLECTION]: [{ _id: 'w', userId: 'u1', balance: 10, version: 1 }],
    })
    await expect(handleAdminAdjustCoin(db, base({ amount: -50 }), { expectedToken: TOKEN, now: NOW }))
      .rejects
      .toThrow(/余额不足/)
  })

  it('相同 refId 入账幂等，不重复入账', async () => {
    const db = makeFakeDb({})
    await handleAdminAdjustCoin(db, base({ amount: 100 }), { expectedToken: TOKEN, now: NOW })
    const res = await handleAdminAdjustCoin(db, base({ amount: 100 }), { expectedToken: TOKEN, now: NOW + 1 })

    expect(res).toEqual({ balance: 100, deduped: true })
    expect(db._store[WALLET_COLLECTION][0]).toMatchObject({ balance: 100, version: 1 })
    expect(db._store[COIN_TX_COLLECTION]).toHaveLength(1)
  })
})
