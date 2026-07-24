import { describe, expect, it } from 'vitest'

import {
  createCloudbaseRewardClaimRateLimit,
  createCloudbaseRewardClaimStore,
  REWARD_CLAIM_ALERTS_COLLECTION,
  REWARD_CLAIM_AUDITS_COLLECTION,
  REWARD_CLAIM_CAMPAIGNS_COLLECTION,
  REWARD_CLAIM_LINKS_COLLECTION,
  REWARD_CLAIM_RATE_LIMITS_COLLECTION,
  REWARD_CLAIMS_COLLECTION,
} from '../../cloudfunctions/account-api/reward-claim-cloudbase.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = 1_800_000_000_000

describe('权益领取 CloudBase 适配器', () => {
  it('在一个事务内持久化活动、链接、领取、审计和去重告警', async () => {
    const db = makeFakeDb()
    const store = createCloudbaseRewardClaimStore(db)

    await store.runTransaction(async (transaction) => {
      await transaction.setCampaign({ _id: 'c1', code: 'campaign-one', createdAt: NOW })
      await transaction.setLink({ _id: 'digest1', campaignId: 'c1', version: 1, status: 'active' })
      await transaction.setClaim({ _id: 'claim1', claimId: 'claim1', campaignId: 'c1', userId: 'u1' })
      await transaction.appendAudit({ _id: 'audit1', campaignId: 'c1', action: 'created', createdAt: NOW })
      await transaction.putAlert({ _id: 'alert1', campaignId: 'c1', kind: 'published', createdAt: NOW })
      await transaction.putAlert({ _id: 'alert1', campaignId: 'c1', kind: 'published', createdAt: NOW })
    })

    expect(db._store[REWARD_CLAIM_CAMPAIGNS_COLLECTION]).toHaveLength(1)
    expect(db._store[REWARD_CLAIM_LINKS_COLLECTION]).toHaveLength(1)
    expect(db._store[REWARD_CLAIMS_COLLECTION]).toHaveLength(1)
    expect(db._store[REWARD_CLAIM_AUDITS_COLLECTION]).toHaveLength(1)
    expect(db._store[REWARD_CLAIM_ALERTS_COLLECTION]).toHaveLength(1)
    await expect(store.getCampaign('c1')).resolves.toMatchObject({ code: 'campaign-one' })
    await expect(store.getClaim('claim1')).resolves.toMatchObject({ userId: 'u1' })
  })

  it('按内部标识防重并列出活动、领取和审计', async () => {
    const db = makeFakeDb({
      [REWARD_CLAIM_CAMPAIGNS_COLLECTION]: [
        { _id: 'c1', code: 'one', createdAt: NOW - 1 },
        { _id: 'c2', code: 'two', createdAt: NOW },
      ],
      [REWARD_CLAIMS_COLLECTION]: [
        { _id: 'a', campaignId: 'c2', userId: 'u1', status: 'succeeded', createdAt: NOW },
        { _id: 'b', campaignId: 'c1', userId: 'u2', status: 'failed', createdAt: NOW },
      ],
      [REWARD_CLAIM_AUDITS_COLLECTION]: [
        { _id: 'x', campaignId: 'c2', createdAt: NOW },
      ],
    })
    const store = createCloudbaseRewardClaimStore(db)

    await store.runTransaction(async (transaction) => {
      await expect(transaction.findCampaignByCode('two')).resolves.toMatchObject({ _id: 'c2' })
    })
    await expect(store.listCampaigns({ limit: 10 })).resolves.toMatchObject({
      items: [{ _id: 'c2' }, { _id: 'c1' }],
      nextSkip: null,
    })
    await expect(store.listClaims({ campaignId: 'c2', limit: 10 })).resolves.toMatchObject({
      items: [{ _id: 'a' }],
      nextSkip: null,
    })
    await expect(store.listAudits({ campaignId: 'c2', limit: 10 })).resolves.toMatchObject({
      items: [{ _id: 'x' }],
      nextSkip: null,
    })
  })

  it('持久化执行单账户和单 IP 固定窗口限流且不保存原始主体', async () => {
    const db = makeFakeDb()
    const limiter = createCloudbaseRewardClaimRateLimit(db, {
      accountLimit: 2,
      ipLimit: 3,
      windowMs: 60_000,
    })
    const input = {
      campaignKey: 'campaign-digest',
      accountHash: 'account-hash',
      ipHash: 'ip-hash-value',
      now: NOW,
    }

    await limiter.consume(input)
    await limiter.consume(input)
    await expect(limiter.consume(input)).rejects.toMatchObject({ code: 'rate_limited' })

    expect(db._store[REWARD_CLAIM_RATE_LIMITS_COLLECTION]).toHaveLength(2)
    expect(JSON.stringify(db._store[REWARD_CLAIM_RATE_LIMITS_COLLECTION])).not.toContain('203.0.113')

    await expect(limiter.consume({ ...input, now: NOW + 60_000 })).resolves.toBeUndefined()
  })
})
