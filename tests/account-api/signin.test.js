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

  it('返回连续签到态（currentStreak / weekProgress / weekLen / milestoneReward）', async () => {
    const db = makeFakeDb({})
    await signIn(db, { userId: 'u1', now: NOW })
    await signIn(db, { userId: 'u1', now: NOW + DAY })
    expect(await getSignInStatus(db, { userId: 'u1', now: NOW + DAY })).toMatchObject({
      signedToday: true,
      currentStreak: 2,
      weekProgress: 2,
      weekLen: 7,
      milestoneReward: 10,
    })
  })

  it('断签后展示 currentStreak=0（今签将从 1 起算）', async () => {
    const db = makeFakeDb({})
    await signIn(db, { userId: 'u1', now: NOW }) // 仅签 day1
    // 查询 day3：昨天=day2 ≠ 最近签到 day1 → 连续已断
    expect(await getSignInStatus(db, { userId: 'u1', now: NOW + 2 * DAY })).toMatchObject({
      signedToday: false,
      currentStreak: 0,
      weekProgress: 0,
    })
  })
})

describe('连续签到 streak + 7 天里程碑', () => {
  it('连续两日 streak 递增', async () => {
    const db = makeFakeDb({})
    const r1 = await signIn(db, { userId: 'u1', now: NOW })
    expect(r1).toMatchObject({ currentStreak: 1, longestStreak: 1, weekProgress: 1, milestone: null })
    const r2 = await signIn(db, { userId: 'u1', now: NOW + DAY })
    expect(r2).toMatchObject({ currentStreak: 2, longestStreak: 2, weekProgress: 2, alreadySigned: false })
  })

  it('断签后 streak 重置为 1，longestStreak 保留历史峰值', async () => {
    const db = makeFakeDb({})
    await signIn(db, { userId: 'u1', now: NOW }) // streak 1
    await signIn(db, { userId: 'u1', now: NOW + DAY }) // streak 2
    // 跳过 day3，day4 再签 → 断签重置
    const r = await signIn(db, { userId: 'u1', now: NOW + 3 * DAY })
    expect(r).toMatchObject({ currentStreak: 1, longestStreak: 2, weekProgress: 1 })
  })

  it('当日重复签到不重复推进 streak', async () => {
    const db = makeFakeDb({})
    await signIn(db, { userId: 'u1', now: NOW })
    const again = await signIn(db, { userId: 'u1', now: NOW + 1000 })
    expect(again).toMatchObject({ alreadySigned: true, currentStreak: 1, milestone: null })
  })

  it('连续 7 天发放里程碑 +10（免费）并一并到账', async () => {
    const db = makeFakeDb({})
    let res
    for (let i = 0; i < 7; i++)
      res = await signIn(db, { userId: 'u1', now: NOW + i * DAY })
    expect(res).toMatchObject({ currentStreak: 7, weekProgress: 7, milestone: { streak: 7, bonus: 10 } })
    // 7 笔日常 +1 + 1 笔里程碑 +10 = 余额 17
    expect(res.balance).toBe(17)
    expect(db._store[COIN_TX_COLLECTION]).toHaveLength(8)
  })

  it('里程碑幂等：里程碑日重复签到不重发', async () => {
    const db = makeFakeDb({})
    for (let i = 0; i < 7; i++)
      await signIn(db, { userId: 'u1', now: NOW + i * DAY }) // 第 7 天触发里程碑
    const again = await signIn(db, { userId: 'u1', now: NOW + 6 * DAY + 1000 })
    expect(again).toMatchObject({ alreadySigned: true, milestone: null, balance: 17 })
    expect(db._store[COIN_TX_COLLECTION]).toHaveLength(8) // 不新增
  })

  it('第 8 天进入下一周期：weekProgress 回到 1，无里程碑', async () => {
    const db = makeFakeDb({})
    let res
    for (let i = 0; i < 8; i++)
      res = await signIn(db, { userId: 'u1', now: NOW + i * DAY })
    expect(res).toMatchObject({ currentStreak: 8, weekProgress: 1, milestone: null })
  })

  it('会员连续 7 天里程碑 +20', async () => {
    const db = makeFakeDb({
      [MEMBERSHIPS_COLLECTION]: [{ _id: 'm', userId: 'vip', expireAt: NOW + 30 * DAY }],
    })
    let res
    for (let i = 0; i < 7; i++)
      res = await signIn(db, { userId: 'vip', now: NOW + i * DAY })
    expect(res.milestone).toMatchObject({ streak: 7, bonus: 20 })
    // 7 天 ×2 = 14 + 里程碑 20 = 34
    expect(res.balance).toBe(34)
  })
})
