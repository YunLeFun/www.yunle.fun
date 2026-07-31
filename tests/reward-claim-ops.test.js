import { describe, expect, it, vi } from 'vitest'

import {
  buildRewardClaimAlertCard,
  formatRewardClaimAlert,
  retryDelayMs,
  runRewardClaimOps,
} from '../cloudfunctions/reward-claim-ops/ops.js'

const NOW = 1_800_000_000_000

describe('权益领取运营告警与巡检', () => {
  it('使用白名单字段生成中文告警，不带令牌、IP 或用户资料', () => {
    const message = formatRewardClaimAlert({
      _id: 'alert-1',
      kind: 'repeated_failures',
      payload: {
        title: '云乐坊内测感谢礼',
        code: 'beta-thanks-202607',
        affectedClaims: 3,
        token: 'raw-secret-token',
        ipHash: 'private-ip-hash',
        userId: 'private-user',
      },
    }, 'https://admin.yunle.fun/reward-claims')

    expect(message).toContain('连续入账异常')
    expect(message).toContain('云乐坊内测感谢礼')
    expect(message).toContain('10 分钟内异常领取：3')
    expect(message).not.toContain('raw-secret-token')
    expect(message).not.toContain('private-ip-hash')
    expect(message).not.toContain('private-user')
  })

  it('生成带活动详情按钮的飞书卡片', () => {
    const card = buildRewardClaimAlertCard({
      _id: 'alert-expired',
      campaignId: 'campaign/beta thanks',
      kind: 'expired',
      payload: {
        title: '云乐坊内测感谢礼',
        code: 'beta-thanks-202607',
        token: 'raw-secret-token',
      },
    }, 'https://admin.yunle.fun/reward-claims?from=alert')

    expect(card.header).toEqual({
      template: 'blue',
      title: { tag: 'plain_text', content: '权益领取 · 活动已到期' },
    })
    expect(card.elements.at(-1)).toMatchObject({
      tag: 'action',
      actions: [{
        text: { content: '查看活动详情' },
        url: 'https://admin.yunle.fun/reward-claims/campaign%2Fbeta%20thanks',
      }],
    })
    expect(JSON.stringify(card)).not.toContain('raw-secret-token')
  })

  it('发送成功标记 sent，失败按尝试次数退避且不阻断其他告警', async () => {
    const alerts = [
      { _id: 'ok', kind: 'published', attempts: 1, payload: { title: '活动一', code: 'one' } },
      { _id: 'fail', kind: 'exhausted', attempts: 2, payload: { title: '活动二', code: 'two' } },
    ]
    const store = {
      leaseDue: vi.fn(async () => alerts),
      markSent: vi.fn(async () => true),
      markFailed: vi.fn(async () => true),
      pruneRateLimits: vi.fn(async () => 4),
    }
    const notify = vi.fn(async (alert) => {
      if (alert._id === 'fail')
        throw new Error('webhook unavailable')
    })

    const result = await runRewardClaimOps({
      sweep: vi.fn(async () => ({ expired: 1, reconciled: 2, errors: [] })),
      store,
      notify,
      now: NOW,
      workerId: 'worker-1',
    })

    expect(result).toMatchObject({
      ok: false,
      sweep: { expired: 1, reconciled: 2 },
      alerts: { leased: 2, sent: 1, failed: 1 },
      prunedRateLimits: 4,
    })
    expect(store.markSent).toHaveBeenCalledWith('ok', 'worker-1', NOW)
    expect(store.markFailed).toHaveBeenCalledWith(
      'fail',
      'worker-1',
      NOW,
      NOW + retryDelayMs(2),
      'webhook unavailable',
    )
  })

  it('巡检失败仍消费已入队告警，并将本轮标为失败', async () => {
    const store = {
      leaseDue: vi.fn(async () => []),
      markSent: vi.fn(),
      markFailed: vi.fn(),
      pruneRateLimits: vi.fn(async () => 0),
    }
    const result = await runRewardClaimOps({
      sweep: vi.fn(async () => {
        throw new Error('account-api unavailable')
      }),
      store,
      notify: vi.fn(),
      now: NOW,
      workerId: 'worker-1',
    })

    expect(store.leaseDue).toHaveBeenCalled()
    expect(result.ok).toBe(false)
    expect(result.sweep).toMatchObject({ error: 'account-api unavailable' })
  })
})
