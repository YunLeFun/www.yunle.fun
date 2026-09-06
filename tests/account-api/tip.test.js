import { describe, expect, it } from 'vitest'

import { cstDateKey } from '../../cloudfunctions/account-api/datetime.js'
import { COIN_TX_COLLECTION, WALLET_COLLECTION } from '../../cloudfunctions/account-api/lib/wallet.js'
import {
  APP_SUPPORTERS_COLLECTION,
  APP_TIP_STATS_COLLECTION,
  getAppSupport,
  getTipLeaderboard,
  tip,
} from '../../cloudfunctions/account-api/tips.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = 1_700_000_000_000

/** 预置：两个公开应用 + 一个余额 10 的用户钱包 */
function seed(overrides = {}) {
  return makeFakeDb({
    apps: [
      { _id: 'a1', slug: 'wenta', legacyTipKey: 'wenta', name: '问他', ownerId: 'owner1', isPublic: true },
      { _id: 'a2', slug: 'other', legacyTipKey: 'other', name: '其它', ownerId: 'owner2', isPublic: true },
    ],
    [WALLET_COLLECTION]: [{ _id: 'w', userId: 'u1', balance: 10, version: 1 }],
    ...overrides,
  })
}

describe('投币 tip', () => {
  it('投 1 币：扣钱包 + 写 consume 流水 + 增热度 + 记支持者', async () => {
    const db = seed()
    const res = await tip(db, { userId: 'u1', appId: 'wenta', now: NOW })
    expect(res).toMatchObject({
      balance: 9,
      tipped: 1,
      slot: 1,
      remainingToday: 1,
      isNewSupporter: true,
      deduped: false,
    })
    expect(db._store[WALLET_COLLECTION][0].balance).toBe(9)
    expect(db._store[COIN_TX_COLLECTION][0]).toMatchObject({
      userId: 'u1',
      appId: 'wenta',
      type: 'consume',
      amount: -1,
      refId: `tip:u1:wenta:${cstDateKey(NOW)}:1`,
    })
    expect(db._store[APP_TIP_STATS_COLLECTION][0]).toMatchObject({
      appId: 'wenta',
      totalCoins: 1,
      tipCount: 1,
      supporterCount: 1,
    })
    expect(db._store[APP_SUPPORTERS_COLLECTION][0]).toMatchObject({
      appId: 'wenta',
      userId: 'u1',
      totalCoins: 1,
      tipCount: 1,
    })
  })

  it('第二次投占 slot 2、第三次报上限；同一支持者不重复计数', async () => {
    const db = seed()
    await tip(db, { userId: 'u1', appId: 'wenta', now: NOW })
    const r2 = await tip(db, { userId: 'u1', appId: 'wenta', now: NOW + 1000 })
    expect(r2).toMatchObject({ slot: 2, remainingToday: 0, isNewSupporter: false })
    expect(db._store[APP_TIP_STATS_COLLECTION][0]).toMatchObject({
      totalCoins: 2,
      tipCount: 2,
      supporterCount: 1,
    })
    await expect(tip(db, { userId: 'u1', appId: 'wenta', now: NOW + 2000 })).rejects.toThrow(/上限/)
    expect(db._store[WALLET_COLLECTION][0].balance).toBe(8) // 只扣了 2 次
  })

  it('给自己应用投币被拒', async () => {
    const db = seed()
    await expect(tip(db, { userId: 'owner1', appId: 'wenta', now: NOW })).rejects.toThrow(/自己/)
  })

  it('应用不存在被拒', async () => {
    const db = seed()
    await expect(tip(db, { userId: 'u1', appId: 'ghost', now: NOW })).rejects.toThrow(/不存在/)
  })

  it('未公开应用被拒', async () => {
    const db = seed({
      apps: [{ _id: 'a3', slug: 'secret', name: '私有', ownerId: 'o', isPublic: false }],
    })
    await expect(tip(db, { userId: 'u1', appId: 'secret', now: NOW })).rejects.toThrow(/未公开/)
  })

  it('余额不足被拒', async () => {
    const db = seed({ [WALLET_COLLECTION]: [{ _id: 'w', userId: 'poor', balance: 0, version: 1 }] })
    await expect(tip(db, { userId: 'poor', appId: 'wenta', now: NOW })).rejects.toThrow(/余额不足/)
  })
})

describe('getAppSupport / getTipLeaderboard', () => {
  it('getAppSupport 反映热度与「我是否支持过」', async () => {
    const db = seed()
    await tip(db, { userId: 'u1', appId: 'wenta', now: NOW })
    expect(await getAppSupport(db, { userId: 'u1', appId: 'wenta' })).toMatchObject({
      totalCoins: 1,
      supporterCount: 1,
      tippedByMe: true,
      myCoins: 1,
    })
    expect(await getAppSupport(db, { userId: 'u2', appId: 'wenta' })).toMatchObject({
      totalCoins: 1,
      tippedByMe: false,
      myCoins: 0,
    })
    // 匿名（无 uid）只看公开计数
    expect((await getAppSupport(db, { userId: '', appId: 'wenta' })).tippedByMe).toBe(false)
  })

  it('getTipLeaderboard 按热度倒序', async () => {
    const db = seed()
    await tip(db, { userId: 'u1', appId: 'wenta', now: NOW })
    await tip(db, { userId: 'u1', appId: 'wenta', now: NOW })
    await tip(db, { userId: 'u1', appId: 'other', now: NOW })
    const board = await getTipLeaderboard(db, { limit: 10 })
    expect(board.items.map(i => i.appId)).toEqual(['wenta', 'other'])
    expect(board.items[0]).toMatchObject({ totalCoins: 2, supporterCount: 1, tipCount: 2 })
  })

  it('公开支持统计排除遗留测试身份的历史投币', async () => {
    const db = seed({
      test_identities: [{ _id: 'identity_01', uid: 'test_uid_01', synthetic: true }],
      [APP_SUPPORTERS_COLLECTION]: [
        { _id: 'support_real', appId: 'wenta', userId: 'u1', totalCoins: 2, tipCount: 2 },
        { _id: 'support_test', appId: 'wenta', userId: 'test_uid_01', totalCoins: 3, tipCount: 3 },
      ],
      [APP_TIP_STATS_COLLECTION]: [{
        _id: 'stats_wenta',
        appId: 'wenta',
        totalCoins: 5,
        supporterCount: 2,
        tipCount: 5,
      }],
    })

    await expect(getAppSupport(db, { userId: 'u1', appId: 'wenta' })).resolves.toMatchObject({
      totalCoins: 2,
      supporterCount: 1,
      tipCount: 2,
    })
    await expect(getTipLeaderboard(db, { limit: 10 })).resolves.toMatchObject({
      items: [{ appId: 'wenta', totalCoins: 2, supporterCount: 1, tipCount: 2 }],
    })
  })
})

describe('投币命名空间隔离', () => {
  it('相同 slug 不会选错应用，ID 投币使用独立账本', async () => {
    const db = seed({ apps: [
      { _id: 'app-a', slug: 'same', ownerUid: 'alice', isPublic: true },
      { _id: 'app_12345678901234567890123456789012', slug: 'same', ownerUid: 'bob', isPublic: true },
    ] })
    await expect(tip(db, { userId: 'u1', appId: 'same', now: NOW })).rejects.toThrow('应用不存在')
    await tip(db, { userId: 'u1', appId: 'app_12345678901234567890123456789012', now: NOW })
    expect(db._store[COIN_TX_COLLECTION][0].appId).toBe('app_12345678901234567890123456789012')
    await expect(tip(db, { userId: 'bob', appId: 'app_12345678901234567890123456789012', now: NOW })).rejects.toThrow('自己')
  })

  it('旧 ID 和旧 slug 共用历史账本和每日限额', async () => {
    const db = seed()
    await tip(db, { userId: 'u1', appId: 'a1', now: NOW })
    await tip(db, { userId: 'u1', appId: 'wenta', now: NOW })
    await expect(tip(db, { userId: 'u1', appId: 'a1', now: NOW })).rejects.toThrow('上限')
    expect((await getAppSupport(db, { userId: 'u1', appId: 'a1' })).totalCoins).toBe(2)
  })
})
