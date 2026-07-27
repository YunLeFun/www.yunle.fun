import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'

import { handleAdminGrantReward } from '../../cloudfunctions/account-api/internal.js'
import { activateMembership, MEMBERSHIPS_COLLECTION } from '../../cloudfunctions/account-api/lib/orders.js'
import { COIN_TX_COLLECTION, deductCoin, WALLET_COLLECTION } from '../../cloudfunctions/account-api/lib/wallet.js'
import { listNotifications, USER_NOTIFICATIONS_COLLECTION } from '../../cloudfunctions/account-api/notifications.js'
import { USER_PROFILES_COLLECTION } from '../../cloudfunctions/account-api/profiles.js'
import {
  correctReward,
  getRewardOperation,
  grantReward,
  listRewardHistory,
  MEMBERSHIP_ENTITLEMENT_TRANSACTIONS_COLLECTION,
  REWARD_OPERATIONS_COLLECTION,
} from '../../cloudfunctions/account-api/rewards.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = 1_700_000_000_000

function realUserDb(extra = {}) {
  return makeFakeDb({
    [USER_PROFILES_COLLECTION]: [
      { _id: 'u1', login: 'alice', nickname: 'Alice', version: 1 },
    ],
    ...extra,
  })
}

function rewardInput(extra = {}) {
  return {
    grantId: 'grant_first_beta_u1',
    campaignId: 'campaign_first_beta',
    userId: 'u1',
    rewardName: '首批内测感谢礼',
    coinAmount: 100,
    membershipDays: 0,
    operator: 'owner',
    now: NOW,
    ...extra,
  }
}

describe('账户奖励发放', () => {
  it('内部奖励接口必须通过服务令牌鉴权', async () => {
    const db = realUserDb()
    await expect(handleAdminGrantReward(db, {
      action: 'adminGrantReward',
      ...rewardInput(),
      rewardControlToken: 'wrong',
    }, {
      rewardControl: { tokens: [Buffer.alloc(32, 7)] },
      now: NOW,
    }))
      .rejects
      .toThrow(/鉴权失败/)
  })

  it('通过稳定 grantId 发放 100 云币且重复执行只到账一次', async () => {
    const db = realUserDb()

    const first = await grantReward(db, rewardInput())
    const replay = await grantReward(db, rewardInput({ now: NOW + 1 }))

    expect(first).toMatchObject({
      grantId: 'grant_first_beta_u1',
      status: 'completed',
      coin: { amount: 100, balanceAfter: 100 },
    })
    expect(replay).toMatchObject({ grantId: 'grant_first_beta_u1', status: 'completed', deduped: true })
    expect(db._store[WALLET_COLLECTION]).toMatchObject([{ userId: 'u1', balance: 100 }])
    expect(db._store[COIN_TX_COLLECTION]).toHaveLength(1)
    expect(db._store[COIN_TX_COLLECTION][0]).toMatchObject({
      userId: 'u1',
      type: 'gift',
      amount: 100,
      refId: 'reward:grant_first_beta_u1:coin',
      meta: {
        source: 'admin_reward',
        rewardName: '首批内测感谢礼',
        campaignId: 'campaign_first_beta',
        grantId: 'grant_first_beta_u1',
      },
    })
    expect(db._store[REWARD_OPERATIONS_COLLECTION]).toHaveLength(1)
    expect(db._store[USER_NOTIFICATIONS_COLLECTION]).toHaveLength(1)
    await expect(getRewardOperation(db, 'grant_first_beta_u1')).resolves.toMatchObject({
      grantId: 'grant_first_beta_u1',
      campaignId: 'campaign_first_beta',
      userId: 'u1',
      status: 'completed',
    })
    await expect(getRewardOperation(db, 'grant_missing_reward')).resolves.toBeNull()
  })

  it('会员奖励支持 30、90、365 天档位并从现有到期时间持续顺延', async () => {
    const day = 86_400_000
    const db = realUserDb({
      [MEMBERSHIPS_COLLECTION]: [{
        _id: 'u1',
        level: 'basic',
        expireAt: NOW + 10 * day,
        createdAt: NOW - day,
        updatedAt: NOW - day,
      }],
    })

    const first = await grantReward(db, rewardInput({ coinAmount: 0, membershipDays: 30 }))
    await grantReward(db, rewardInput({ coinAmount: 0, membershipDays: 30, now: NOW + 1 }))
    const second = await grantReward(db, rewardInput({
      grantId: 'grant_second_beta_u1',
      campaignId: 'campaign_second_beta',
      coinAmount: 0,
      membershipDays: 90,
      now: NOW + 2,
    }))
    const third = await grantReward(db, rewardInput({
      grantId: 'grant_year_beta_u1',
      campaignId: 'campaign_year_beta',
      coinAmount: 0,
      membershipDays: 365,
      now: NOW + 3,
    }))

    expect(first.membership).toEqual({
      days: 30,
      expireBefore: NOW + 10 * day,
      expireAfter: NOW + 40 * day,
    })
    expect(second.membership.expireAfter).toBe(NOW + 130 * day)
    expect(third.membership.expireAfter).toBe(NOW + 495 * day)
    expect(db._store[MEMBERSHIPS_COLLECTION][0].expireAt).toBe(NOW + 495 * day)
    expect(db._store[MEMBERSHIPS_COLLECTION][0]).not.toHaveProperty('userId')
    expect(db._store[MEMBERSHIP_ENTITLEMENT_TRANSACTIONS_COLLECTION]).toHaveLength(3)
  })

  it('首次会员奖励以 uid 主键创建记录且不写冗余 userId', async () => {
    const day = 86_400_000
    const db = realUserDb()

    const result = await grantReward(db, rewardInput({
      coinAmount: 0,
      membershipDays: 30,
    }))

    expect(result.membership).toMatchObject({
      expireBefore: null,
      expireAfter: NOW + 30 * day,
    })
    expect(db._store[MEMBERSHIPS_COLLECTION]).toEqual([
      expect.objectContaining({
        _id: 'u1',
        expireAt: NOW + 30 * day,
      }),
    ])
    expect(db._store[MEMBERSHIPS_COLLECTION][0]).not.toHaveProperty('userId')
  })

  it('固定天数奖励后，下一次月付从奖励后的实际到期日顺延', async () => {
    const purchaseAt = Date.parse('2026-01-15T10:00:00+08:00')
    const expireBefore = Date.parse('2026-02-15T10:00:00+08:00')
    const expireAfterReward = Date.parse('2026-03-17T10:00:00+08:00')
    const expireAfterRenewal = Date.parse('2026-04-17T10:00:00+08:00')
    const db = realUserDb({
      [MEMBERSHIPS_COLLECTION]: [{
        _id: 'u1',
        level: 'basic',
        activeCycle: 'month',
        expireAt: expireBefore,
        billingAnchorDay: 15,
        billingAnchorIsMonthEnd: false,
        createdAt: purchaseAt,
        updatedAt: purchaseAt,
      }],
    })

    await grantReward(db, rewardInput({
      coinAmount: 0,
      membershipDays: 30,
      now: purchaseAt + 1,
    }))
    const afterReward = db._store[MEMBERSHIPS_COLLECTION][0]
    expect(afterReward).toMatchObject({
      expireAt: expireAfterReward,
      billingAnchorDay: 17,
      billingAnchorIsMonthEnd: false,
    })

    const renewed = await activateMembership(db, {
      userId: 'u1',
      planId: 'basic',
      cycle: 'month',
      now: purchaseAt + 2,
      outTradeNo: 'YLF-AFTER-REWARD',
    })
    expect(renewed.expireAt).toBe(expireAfterRenewal)
  })

  it('支持 1000 云币并拒绝白名单外额度、受管测试身份和已注销账户', async () => {
    const largeReward = await grantReward(realUserDb(), rewardInput({ coinAmount: 1000 }))
    expect(largeReward.coin).toMatchObject({ amount: 1000, balanceAfter: 1000 })

    await expect(grantReward(realUserDb(), rewardInput({ coinAmount: 101 })))
      .rejects
      .toThrow(/仅支持 100、1000/)
    await expect(grantReward(realUserDb(), rewardInput({ coinAmount: 0, membershipDays: 180 })))
      .rejects
      .toThrow(/仅支持 30、90、365 天/)

    const syntheticDb = realUserDb({
      test_identities: [{ _id: 'test-1', uid: 'u1', synthetic: true }],
    })
    await expect(grantReward(syntheticDb, rewardInput()))
      .rejects
      .toThrow(/测试身份/)

    const deletedDb = makeFakeDb({
      [USER_PROFILES_COLLECTION]: [{ _id: 'u1', deletedAt: NOW - 1 }],
    })
    await expect(grantReward(deletedDb, rewardInput()))
      .rejects
      .toThrow(/已注销/)
  })

  it('纠正云币奖励时最多追回当前余额并记录未追回差额', async () => {
    const db = realUserDb()
    await grantReward(db, rewardInput())
    await deductCoin(db, {
      userId: 'u1',
      appId: 'wish',
      amount: 60,
      bizId: 'wish:used-after-reward',
      now: NOW + 1,
    })

    const corrected = await correctReward(db, {
      correctionId: 'correction_first_beta_u1',
      grantId: 'grant_first_beta_u1',
      reason: '名单录入错误',
      operator: 'owner',
      now: NOW + 2,
    })
    const replay = await correctReward(db, {
      correctionId: 'correction_first_beta_u1',
      grantId: 'grant_first_beta_u1',
      reason: '名单录入错误',
      operator: 'owner',
      now: NOW + 3,
    })

    expect(corrected).toMatchObject({
      status: 'completed',
      coin: { requested: 100, recovered: 40, shortfall: 60, balanceAfter: 0 },
    })
    expect(replay).toMatchObject({ status: 'completed', deduped: true })
    expect(db._store[WALLET_COLLECTION][0].balance).toBe(0)
    expect(db._store[COIN_TX_COLLECTION].filter(tx => tx.meta?.rewardCorrection)).toHaveLength(1)
  })

  it('奖励纠正后重放原 grantId 不得恢复状态或再次到账', async () => {
    const db = realUserDb()
    await grantReward(db, rewardInput())
    await correctReward(db, {
      correctionId: 'correction_replay_guard_u1',
      grantId: 'grant_first_beta_u1',
      reason: '名单录入错误',
      operator: 'owner',
      now: NOW + 1,
    })

    const replay = await grantReward(db, rewardInput({ now: NOW + 2 }))

    expect(replay).toMatchObject({
      grantId: 'grant_first_beta_u1',
      status: 'corrected',
      deduped: true,
    })
    expect(db._store[WALLET_COLLECTION][0].balance).toBe(0)
    expect(db._store[COIN_TX_COLLECTION]).toHaveLength(2)
    expect(db._store[REWARD_OPERATIONS_COLLECTION][0].status).toBe('corrected')
  })

  it('会员纠正只撤销能够明确归属的剩余奖励时长', async () => {
    const day = 86_400_000
    const db = realUserDb()
    await grantReward(db, rewardInput({ coinAmount: 0, membershipDays: 30 }))

    const corrected = await correctReward(db, {
      correctionId: 'correction_membership_u1',
      grantId: 'grant_first_beta_u1',
      reason: '名单录入错误',
      operator: 'owner',
      now: NOW + 10 * day,
    })

    expect(corrected).toMatchObject({
      status: 'completed',
      membership: {
        requestedDays: 30,
        recoveredDays: 20,
        expireBefore: NOW + 30 * day,
        expireAfter: NOW + 10 * day,
      },
    })
    expect(db._store[MEMBERSHIPS_COLLECTION][0].expireAt).toBe(NOW + 10 * day)
    expect(db._store[MEMBERSHIP_ENTITLEMENT_TRANSACTIONS_COLLECTION]).toHaveLength(2)
  })

  it('会员在奖励后发生其它续期时拒绝自动缩短并转人工复核', async () => {
    const day = 86_400_000
    const db = realUserDb()
    await grantReward(db, rewardInput({ coinAmount: 0, membershipDays: 30 }))
    await grantReward(db, rewardInput({
      grantId: 'grant_later_membership_u1',
      campaignId: 'campaign_later_membership',
      coinAmount: 0,
      membershipDays: 30,
      now: NOW + 1,
    }))

    const corrected = await correctReward(db, {
      correctionId: 'correction_first_after_later_u1',
      grantId: 'grant_first_beta_u1',
      reason: '名单录入错误',
      operator: 'owner',
      now: NOW + 2,
    })

    expect(corrected).toMatchObject({
      status: 'manual_review_required',
      membership: { status: 'manual_review_required' },
    })
    expect(db._store[MEMBERSHIPS_COLLECTION][0].expireAt).toBe(NOW + 60 * day)
  })

  it('用户只能查询到友好奖励名称、到账内容和时间', async () => {
    const db = realUserDb()
    await grantReward(db, rewardInput({ membershipDays: 30 }))

    const history = await listRewardHistory(db, { userId: 'u1' })
    const notifications = await listNotifications(db, { userId: 'u1' })

    expect(history.items).toEqual([{
      grantId: 'grant_first_beta_u1',
      rewardName: '首批内测感谢礼',
      coinAmount: 100,
      membershipDays: 30,
      status: 'completed',
      creditedAt: NOW,
      correction: null,
    }])
    expect(history.items[0]).not.toHaveProperty('operator')
    expect(notifications.items[0]).toEqual({
      id: expect.any(String),
      type: 'reward',
      read: false,
      createdAt: NOW,
      reward: {
        grantId: 'grant_first_beta_u1',
        rewardName: '首批内测感谢礼',
        coinAmount: 100,
        membershipDays: 30,
      },
    })
  })
})
