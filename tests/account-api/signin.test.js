import { describe, expect, it } from 'vitest'

import { cstDateKey } from '../../cloudfunctions/account-api/datetime.js'
import { MEMBERSHIPS_COLLECTION } from '../../cloudfunctions/account-api/lib/orders.js'
import { COIN_TX_COLLECTION, WALLET_COLLECTION } from '../../cloudfunctions/account-api/lib/wallet.js'
import { getSignInStatus, signIn } from '../../cloudfunctions/account-api/signin.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = 1_700_000_000_000 // 对应东八区 2023-11-15
const DAY = 86_400_000

describe('cstDateKey 东八区切日', () => {
  it('东八区切日：UTC 17:00 属次日', () => {
    expect(cstDateKey(Date.UTC(2024, 0, 1, 17, 0, 0))).toBe('2024-01-02')
  })
  it('东八区切日：UTC 15:59 仍属当日', () => {
    expect(cstDateKey(Date.UTC(2024, 0, 1, 15, 59, 0))).toBe('2024-01-01')
  })
})

describe('每日签到 signIn', () => {
  it('免费用户签到 +1 云币并写 gift 流水', async () => {
    const db = makeFakeDb({})
    const res = await signIn(db, { userId: 'u1', now: NOW })
    expect(res).toMatchObject({ balance: 1, reward: 1, alreadySigned: false })
    expect(db._store[WALLET_COLLECTION][0]).toMatchObject({ userId: 'u1', balance: 1 })
    expect(db._store[COIN_TX_COLLECTION][0]).toMatchObject({
      userId: 'u1',
      type: 'gift',
      amount: 1,
      refId: `signin:u1:${cstDateKey(NOW)}`,
    })
  })

  it('会员签到 +2 云币', async () => {
    const db = makeFakeDb({
      [MEMBERSHIPS_COLLECTION]: [{ _id: 'm', userId: 'vip', level: 'basic', expireAt: NOW + DAY }],
    })
    const res = await signIn(db, { userId: 'vip', now: NOW })
    expect(res).toMatchObject({ balance: 2, reward: 2, alreadySigned: false, isMember: true })
  })

  it('会员已过期按免费 +1', async () => {
    const db = makeFakeDb({
      [MEMBERSHIPS_COLLECTION]: [{ _id: 'm', userId: 'ex', level: 'basic', expireAt: NOW - DAY }],
    })
    const res = await signIn(db, { userId: 'ex', now: NOW })
    expect(res.reward).toBe(1)
  })

  it('当日重复签到幂等：不重复入账', async () => {
    const db = makeFakeDb({})
    await signIn(db, { userId: 'u1', now: NOW })
    const res = await signIn(db, { userId: 'u1', now: NOW + 1000 })
    expect(res).toMatchObject({ balance: 1, alreadySigned: true })
    expect(db._store[COIN_TX_COLLECTION]).toHaveLength(1)
    expect(db._store[WALLET_COLLECTION][0].balance).toBe(1)
  })

  it('跨自然日可再次签到', async () => {
    const db = makeFakeDb({})
    await signIn(db, { userId: 'u1', now: NOW })
    const res = await signIn(db, { userId: 'u1', now: NOW + DAY })
    expect(res).toMatchObject({ alreadySigned: false, balance: 2 })
    expect(db._store[COIN_TX_COLLECTION]).toHaveLength(2)
  })
})

describe('getSignInStatus', () => {
  it('未签到：signedToday=false，免费 reward=1', async () => {
    const db = makeFakeDb({})
    expect(await getSignInStatus(db, { userId: 'u1', now: NOW })).toMatchObject({
      signedToday: false,
      reward: 1,
      isMember: false,
    })
  })

  it('已签到：signedToday=true 且回报实际入账额', async () => {
    const db = makeFakeDb({
      [MEMBERSHIPS_COLLECTION]: [{ _id: 'm', userId: 'vip', expireAt: NOW + DAY }],
    })
    await signIn(db, { userId: 'vip', now: NOW })
    expect(await getSignInStatus(db, { userId: 'vip', now: NOW })).toMatchObject({
      signedToday: true,
      reward: 2,
    })
  })
})
