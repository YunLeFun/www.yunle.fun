import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'

import { COIN_TX_COLLECTION, WALLET_COLLECTION } from '../../cloudfunctions/account-api/lib/wallet.js'
import { USER_NOTIFICATIONS_COLLECTION } from '../../cloudfunctions/account-api/notifications.js'
import { USER_PROFILES_COLLECTION } from '../../cloudfunctions/account-api/profiles.js'
import {
  createRewardClaimRuntime,
} from '../../cloudfunctions/account-api/reward-claim-runtime.js'
import { REWARD_OPERATIONS_COLLECTION } from '../../cloudfunctions/account-api/rewards.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = 1_800_000_000_000
const OWNER = { login: 'yunyou', role: 'owner' }
const ENV = {
  ACCOUNT_API_INTERNAL_TOKEN: 'account-api-token-that-is-at-least-32-bytes',
  REWARD_CLAIM_LINK_HASH_KEY: 'link-hash-key-that-is-at-least-32-bytes',
  REWARD_CLAIM_RATE_TICKET_SECRET: 'rate-ticket-key-that-is-at-least-32-bytes',
  REWARD_CLAIM_MEMBERSHIP_HIGH_THRESHOLD_DAYS: '3650',
  REWARD_CLAIM_SITE_URL: 'https://www.yunle.fun',
}

function campaignInput() {
  return {
    title: '云乐坊内测感谢礼',
    description: '感谢参与云乐坊内测，领取一份云币礼遇。',
    code: 'runtime-beta-thanks',
    distributionMode: 'shared',
    reward: { coinAmount: 100, membershipDays: 0 },
    totalInventory: 1,
    startsAt: NOW,
    endsAt: NOW + 86_400_000,
  }
}

describe('权益领取生产运行时适配', () => {
  it('通过现有奖励模块完成一笔领取、流水和用户通知', async () => {
    const db = makeFakeDb({
      [USER_PROFILES_COLLECTION]: [
        { _id: 'u1', nickname: '云游者', version: 1 },
      ],
    })
    const runtime = createRewardClaimRuntime(db, {
      env: ENV,
      now: () => NOW,
      randomBytes: size => Buffer.alloc(size, 11),
    })
    const draft = await runtime.service.createDraft(campaignInput(), OWNER)
    const published = await runtime.service.publish(draft._id, {}, OWNER)
    const rateTicket = runtime.rateTicket.issueForRequest({
      rawToken: published.rawToken,
      ip: '203.0.113.8',
    })

    const result = await runtime.service.claim({
      token: published.rawToken,
      rateTicket,
    }, 'u1')

    expect(result).toMatchObject({ status: 'succeeded', balanceAfter: 100 })
    expect(db._store[WALLET_COLLECTION]).toMatchObject([{ userId: 'u1', balance: 100 }])
    expect(db._store[COIN_TX_COLLECTION]).toHaveLength(1)
    expect(db._store[REWARD_OPERATIONS_COLLECTION]).toHaveLength(1)
    expect(db._store[USER_NOTIFICATIONS_COLLECTION]).toHaveLength(1)
  })

  it('正式运行时拒绝受管 synthetic 身份', async () => {
    const db = makeFakeDb({
      [USER_PROFILES_COLLECTION]: [
        { _id: 'u1', nickname: '测试身份', version: 1 },
      ],
      test_identities: [
        { _id: 'test-1', uid: 'u1', synthetic: true },
      ],
    })
    const runtime = createRewardClaimRuntime(db, {
      env: ENV,
      now: () => NOW,
      randomBytes: size => Buffer.alloc(size, 12),
    })
    const draft = await runtime.service.createDraft(campaignInput(), OWNER)
    const published = await runtime.service.publish(draft._id, {}, OWNER)
    const rateTicket = runtime.rateTicket.issueForRequest({
      rawToken: published.rawToken,
      ip: '203.0.113.8',
    })

    await expect(runtime.service.claim({
      token: published.rawToken,
      rateTicket,
    }, 'u1')).rejects.toMatchObject({ code: 'account_ineligible' })
    expect(db._store[WALLET_COLLECTION] || []).toHaveLength(0)
  })
})
