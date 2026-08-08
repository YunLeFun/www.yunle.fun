import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'

import {
  createRewardClaimCampaignService,
  RewardClaimError,
} from '../../cloudfunctions/account-api/reward-claim-campaigns.js'

const NOW = 1_800_000_000_000
const OWNER = { login: 'yunyou', role: 'owner' }

function clone(value) {
  return value === undefined ? undefined : structuredClone(value)
}

function createMemoryStore() {
  const state = {
    campaigns: new Map(),
    links: new Map(),
    claims: new Map(),
    audits: [],
    alerts: new Map(),
  }
  let tail = Promise.resolve()

  function transactionView(snapshot) {
    return {
      getCampaign: async id => clone(snapshot.campaigns.get(id) ?? null),
      findCampaignByCode: async code =>
        clone([...snapshot.campaigns.values()].find(item => item.code === code) ?? null),
      setCampaign: async campaign => snapshot.campaigns.set(campaign._id, clone(campaign)),
      getLink: async digest => clone(snapshot.links.get(digest) ?? null),
      listActiveLinks: async campaignId => [...snapshot.links.values()]
        .filter(item => item.campaignId === campaignId && item.status === 'active')
        .map(clone),
      setLink: async link => snapshot.links.set(link._id, clone(link)),
      getClaim: async claimId => clone(snapshot.claims.get(claimId) ?? null),
      setClaim: async claim => snapshot.claims.set(claim._id, clone(claim)),
      appendAudit: async audit => snapshot.audits.push(clone(audit)),
      putAlert: async alert => snapshot.alerts.set(alert._id, clone(alert)),
    }
  }

  return {
    state,
    async runTransaction(callback) {
      const previous = tail
      let release
      tail = new Promise((resolve) => {
        release = resolve
      })
      await previous
      const snapshot = structuredClone(state)
      try {
        const result = await callback(transactionView(snapshot))
        state.campaigns = snapshot.campaigns
        state.links = snapshot.links
        state.claims = snapshot.claims
        state.audits = snapshot.audits
        state.alerts = snapshot.alerts
        return result
      }
      finally {
        release()
      }
    },
    async getCampaign(id) {
      return clone(state.campaigns.get(id) ?? null)
    },
    async getLink(digest) {
      return clone(state.links.get(digest) ?? null)
    },
    async getClaim(claimId) {
      return clone(state.claims.get(claimId) ?? null)
    },
    async listCampaigns({ limit = 20, skip = 0 } = {}) {
      const items = [...state.campaigns.values()]
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(skip, skip + limit)
        .map(clone)
      return { items, nextSkip: items.length === limit ? skip + limit : null }
    },
    async listClaims({ campaignId, status, limit = 20, skip = 0 } = {}) {
      const items = [...state.claims.values()]
        .filter(item => item.campaignId === campaignId && (!status || item.status === status))
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(skip, skip + limit)
        .map(clone)
      return { items, nextSkip: items.length === limit ? skip + limit : null }
    },
    async listAudits({ campaignId, limit = 20, skip = 0 } = {}) {
      const items = state.audits
        .filter(item => item.campaignId === campaignId)
        .slice(skip, skip + limit)
        .map(clone)
      return { items, nextSkip: items.length === limit ? skip + limit : null }
    },
    async listAlerts({ campaignId, limit = 20, skip = 0 } = {}) {
      const items = [...state.alerts.values()]
        .filter(item => item.campaignId === campaignId)
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(skip, skip + limit)
        .map(clone)
      return { items, nextSkip: items.length === limit ? skip + limit : null }
    },
  }
}

function createHarness(overrides = {}) {
  const store = createMemoryStore()
  const grants = new Map()
  const calls = []
  let tokenSequence = 0
  const service = createRewardClaimCampaignService({
    store,
    now: () => NOW,
    id: {
      campaign: code => `rcc_${code}`,
      claim: (campaignId, userId) => `rcl_${campaignId}_${userId}`,
      grant: (campaignId, userId) => `grant:claim:${campaignId}:${userId}`,
      audit: (_campaignId, action, at) => `audit_${action}_${at}`,
      alert: (campaignId, kind, version) => `alert_${campaignId}_${kind}_${version}`,
    },
    token: {
      generate: () => `token-${++tokenSequence}-with-enough-entropy-for-tests`,
      digest: raw => crypto.createHash('sha256').update(raw).digest('hex'),
      publicUrl: raw => `https://www.yunle.fun/claim#${raw}`,
    },
    rateTicket: {
      verify: async () => ({ ipHash: 'ip-hash' }),
    },
    rateLimit: {
      consume: async () => {},
    },
    eligibility: {
      inspect: async userId => ({ eligible: true, nickname: `用户-${userId}` }),
    },
    reward: {
      async grant(input) {
        calls.push(input)
        const existing = grants.get(input.grantId)
        if (existing)
          return { ...existing, deduped: true }
        const result = { kind: 'completed', grantId: input.grantId, balanceAfter: 100 }
        grants.set(input.grantId, result)
        return result
      },
      async inspect(grantId) {
        return grants.get(grantId) ?? { kind: 'absent' }
      },
      async correct() {
        return { status: 'completed' }
      },
    },
    ...overrides,
  })

  return { service, store, calls, grants }
}

function draftInput(overrides = {}) {
  return {
    title: '云乐坊内测感谢礼',
    description: '感谢参与云乐坊内测，领取一份云币礼遇。',
    code: 'beta-thanks-202607',
    distributionMode: 'shared',
    reward: { coinAmount: 100, membershipDays: 0 },
    totalInventory: 2,
    startsAt: NOW,
    endsAt: NOW + 7 * 86_400_000,
    ...overrides,
  }
}

async function publishedHarness(overrides = {}) {
  const harness = createHarness(overrides)
  const campaign = await harness.service.createDraft(draftInput(), OWNER)
  const published = await harness.service.publish(campaign._id, {}, OWNER)
  return { ...harness, campaign, token: published.rawToken }
}

describe('权益领取活动领域服务', () => {
  it('创建草稿并预览最大责任、标题提示和强确认', async () => {
    const { service } = createHarness()
    const preview = service.preview(draftInput({
      reward: { coinAmount: 1000, membershipDays: 0 },
      totalInventory: 50,
    }))

    expect(preview).toMatchObject({
      coinLiability: 50_000,
      yuanApprox: 5000,
      membershipDaysLiability: 0,
      requiresStrongConfirmation: true,
      confirmationReasons: expect.arrayContaining(['single_coin_1000', 'coin_total_10000']),
    })
    expect(preview.titleWarnings).toEqual([])

    const campaign = await service.createDraft(draftInput({ title: '首批100云币' }), OWNER)
    expect(campaign.lifecycle).toBe('draft')
    expect(campaign.titleWarnings).toEqual(expect.arrayContaining(['avoid_amount', 'avoid_batch']))
  })

  it('发布后冻结承诺、只返回一次明文链接并支持轮换', async () => {
    const { service, store, campaign, token } = await publishedHarness()

    expect(token).toMatch(/^token-/)
    expect(JSON.stringify([...store.state.links.values()])).not.toContain(token)
    const publicView = await service.inspect(token)
    expect(publicView.availability).toBe('active')
    expect(publicView.campaign).not.toHaveProperty('remainingCount')

    const rotated = await service.rotateLink(campaign._id, OWNER)
    expect(rotated.rawToken).not.toBe(token)
    expect((await service.inspect(token)).availability).toBe('unavailable')
    expect((await service.inspect(rotated.rawToken)).availability).toBe('active')

    await expect(service.updateDraft(campaign._id, { title: '已发布后修改' }, OWNER))
      .rejects
      .toMatchObject({ code: 'campaign_immutable' })
  })

  it('同一用户重复领取只调用一次稳定 grantId', async () => {
    const { service, token, calls } = await publishedHarness()

    const first = await service.claim({ token, rateTicket: 'ticket' }, 'u1')
    const replay = await service.claim({ token, rateTicket: 'ticket' }, 'u1')

    expect(first).toMatchObject({ status: 'succeeded', balanceAfter: 100 })
    expect(replay).toEqual(first)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      userId: 'u1',
      rewardName: '云乐坊内测感谢礼',
      coinAmount: 100,
      membershipDays: 0,
    })
  })

  it('资格适配器未提供昵称时快照使用稳定默认昵称', async () => {
    const { service, token, store } = await publishedHarness({
      eligibility: {
        inspect: async () => ({ eligible: true, nickname: '' }),
      },
    })

    await service.claim({ token, rateTicket: 'ticket' }, 'u1')

    expect([...store.state.claims.values()][0]).toMatchObject({
      userId: 'u1',
      nicknameSnapshot: '云游者_uymn',
    })
  })

  it('并发争抢最后一份库存不会超发', async () => {
    const { service, token, store } = await publishedHarness()
    const campaign = [...store.state.campaigns.values()][0]
    campaign.totalInventory = 1
    store.state.campaigns.set(campaign._id, campaign)

    const results = await Promise.allSettled([
      service.claim({ token, rateTicket: 'ticket' }, 'u1'),
      service.claim({ token, rateTicket: 'ticket' }, 'u2'),
    ])

    expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(item => item.status === 'rejected')
    expect(rejected.reason).toBeInstanceOf(RewardClaimError)
    expect(rejected.reason.code).toBe('campaign_exhausted')

    const after = [...store.state.campaigns.values()][0]
    expect(after).toMatchObject({
      totalInventory: 1,
      reservedCount: 0,
      succeededCount: 1,
    })
    expect(store.state.claims.size).toBe(1)
  })

  it('未知到账结果保留预占，重试查询原 grantId 后完成收尾', async () => {
    let attempt = 0
    const settled = new Map()
    const { service, token, store } = await publishedHarness({
      reward: {
        async grant(input) {
          attempt++
          if (attempt === 1)
            return { kind: 'unknown', code: 'timeout', message: 'timeout' }
          const result = { kind: 'completed', grantId: input.grantId, balanceAfter: 100 }
          settled.set(input.grantId, result)
          return result
        },
        async inspect(grantId) {
          return settled.get(grantId) ?? { kind: 'absent' }
        },
        async correct() {
          return { status: 'completed' }
        },
      },
    })

    const first = await service.claim({ token, rateTicket: 'ticket' }, 'u1')
    expect(first).toMatchObject({ status: 'processing' })
    let campaign = [...store.state.campaigns.values()][0]
    expect(campaign).toMatchObject({ reservedCount: 1, succeededCount: 0 })

    const retry = await service.claim({ token, rateTicket: 'ticket' }, 'u1')
    expect(retry).toMatchObject({ status: 'succeeded', balanceAfter: 100 })
    campaign = [...store.state.campaigns.values()][0]
    expect(campaign).toMatchObject({ reservedCount: 0, succeededCount: 1 })
    expect(store.state.claims.size).toBe(1)
  })

  it('暂停、过期和耗尽拒绝新领取，但成功历史仍可查看', async () => {
    const { service, campaign, token } = await publishedHarness()
    await service.claim({ token, rateTicket: 'ticket' }, 'u1')
    await service.changeLifecycle(campaign._id, 'pause', OWNER)

    expect((await service.inspect(token, 'u1')).viewer.claim.status).toBe('succeeded')
    await expect(service.claim({ token, rateTicket: 'ticket' }, 'u2'))
      .rejects
      .toMatchObject({ code: 'campaign_paused' })
  })

  it('十分钟内三个未知或失败领取只生成一条连续失败告警', async () => {
    const { service, token, store } = await publishedHarness({
      reward: {
        async grant() {
          return { kind: 'unknown', code: 'timeout', message: 'timeout' }
        },
        async inspect() {
          return { kind: 'absent' }
        },
        async correct() {
          return { status: 'completed' }
        },
      },
    })
    const campaign = [...store.state.campaigns.values()][0]
    campaign.totalInventory = 3
    store.state.campaigns.set(campaign._id, campaign)

    await service.claim({ token, rateTicket: 'ticket' }, 'u1')
    await service.claim({ token, rateTicket: 'ticket' }, 'u2')
    await service.claim({ token, rateTicket: 'ticket' }, 'u3')
    await service.sweep({ login: 'reward-claim-sweeper', role: 'system' })
    await service.sweep({ login: 'reward-claim-sweeper', role: 'system' })

    const alerts = [...store.state.alerts.values()]
      .filter(item => item.kind === 'repeated_failures')
    expect(alerts).toHaveLength(1)
    expect(alerts[0].payload).toMatchObject({ affectedClaims: 3 })
  })

  it('对账已恢复的未知领取不会触发连续失败告警', async () => {
    let current = NOW
    const { service, token, store } = await publishedHarness({
      now: () => current,
      reward: {
        async grant() {
          return { kind: 'unknown', code: 'timeout', message: 'timeout' }
        },
        async inspect(grantId) {
          return { kind: 'completed', grantId, balanceAfter: 100 }
        },
        async correct() {
          return { status: 'completed' }
        },
      },
    })
    const campaign = [...store.state.campaigns.values()][0]
    campaign.totalInventory = 3
    store.state.campaigns.set(campaign._id, campaign)

    await service.claim({ token, rateTicket: 'ticket' }, 'u1')
    await service.claim({ token, rateTicket: 'ticket' }, 'u2')
    await service.claim({ token, rateTicket: 'ticket' }, 'u3')
    current += 120_001
    await service.sweep({ login: 'reward-claim-sweeper', role: 'system' })

    expect([...store.state.claims.values()].every(item => item.status === 'succeeded')).toBe(true)
    expect([...store.state.alerts.values()]
      .filter(item => item.kind === 'repeated_failures')).toHaveLength(0)
  })

  it('最后一份库存被未知领取预占时立即生成耗尽告警', async () => {
    const { service, token, store } = await publishedHarness({
      reward: {
        async grant() {
          return { kind: 'unknown', code: 'timeout', message: 'timeout' }
        },
        async inspect() {
          return { kind: 'absent' }
        },
        async correct() {
          return { status: 'completed' }
        },
      },
    })
    const campaign = [...store.state.campaigns.values()][0]
    campaign.totalInventory = 1
    store.state.campaigns.set(campaign._id, campaign)

    await service.claim({ token, rateTicket: 'ticket' }, 'u1')

    expect([...store.state.alerts.values()]
      .filter(item => item.kind === 'exhausted')).toHaveLength(1)
  })

  it('自动巡检最多把未知领取尝试次数推进到三次', async () => {
    let current = NOW
    let inspections = 0
    const { service, token, store } = await publishedHarness({
      now: () => current,
      reward: {
        async grant() {
          return { kind: 'unknown', code: 'timeout', message: 'timeout' }
        },
        async inspect() {
          inspections++
          return { kind: 'absent' }
        },
        async correct() {
          return { status: 'completed' }
        },
      },
    })
    await service.claim({ token, rateTicket: 'ticket' }, 'u1')

    for (let run = 0; run < 3; run++) {
      current += 120_001
      await service.sweep({ login: 'reward-claim-sweeper', role: 'system' })
    }

    expect([...store.state.claims.values()][0]).toMatchObject({
      status: 'processing',
      attempts: 3,
      reservationHeld: true,
    })
    expect(inspections).toBe(2)
  })

  it('库存不变量异常时暂停活动、写审计和异常告警后拒绝领取', async () => {
    const { service, token, store } = await publishedHarness()
    const campaign = [...store.state.campaigns.values()][0]
    campaign.reservedCount = campaign.totalInventory + 1
    store.state.campaigns.set(campaign._id, campaign)

    await expect(service.claim({ token, rateTicket: 'ticket' }, 'u1'))
      .rejects
      .toMatchObject({ code: 'data_inconsistent' })

    expect(store.state.campaigns.get(campaign._id).lifecycle).toBe('paused')
    expect(store.state.audits.some(item => item.action === 'campaign_quarantined')).toBe(true)
    expect([...store.state.alerts.values()]
      .some(item => item.kind === 'data_inconsistent')).toBe(true)
  })
})
