import { describe, expect, it, vi } from 'vitest'

import {
  createRewardClaimActionRouter,
  isRewardClaimAction,
} from '../../cloudfunctions/account-api/reward-claim-routing.js'

function createHarness() {
  const service = {
    inspect: vi.fn(async (token, viewerId) => ({ token, viewerId })),
    claim: vi.fn(async (input, userId) => ({ input, userId })),
    preview: vi.fn(input => ({ input })),
    createDraft: vi.fn(async (input, actor) => ({ input, actor })),
    publish: vi.fn(async (id, input, actor) => ({ id, input, actor })),
    changeLifecycle: vi.fn(async (id, action, actor) => ({ id, action, actor })),
    addInventory: vi.fn(async (id, input, actor) => ({ id, input, actor })),
    rotateLink: vi.fn(async (id, actor) => ({ id, actor })),
    listCampaigns: vi.fn(async (input, actor) => ({ input, actor })),
    getAdminCampaign: vi.fn(async (id, actor) => ({ id, actor })),
    listClaims: vi.fn(async (id, input, actor) => ({ id, input, actor })),
    reconcile: vi.fn(async (claimId, actor) => ({ claimId, actor })),
    correct: vi.fn(async (claimId, reason, actor) => ({ claimId, reason, actor })),
    sweep: vi.fn(async actor => ({ actor })),
  }
  const assertInternalServiceToken = vi.fn((token) => {
    if (token !== 'valid-token')
      throw new Error('内部服务鉴权失败')
  })
  return {
    service,
    assertInternalServiceToken,
    router: createRewardClaimActionRouter({ service, assertInternalServiceToken }),
  }
}

describe('权益领取 account-api action 路由', () => {
  it('只识别显式领取 actions', () => {
    expect(isRewardClaimAction('getRewardClaimCampaign')).toBe(true)
    expect(isRewardClaimAction('claimRewardCampaign')).toBe(true)
    expect(isRewardClaimAction('adminPublishRewardClaimCampaign')).toBe(true)
    expect(isRewardClaimAction('getAccount')).toBe(false)
  })

  it('公开读取使用可选登录 UID，领取 UID 只来自服务端调用参数', async () => {
    const { router, service } = createHarness()

    await expect(router.dispatch({
      event: { action: 'getRewardClaimCampaign', token: 'link', userId: 'spoofed' },
      callerUid: 'real-user',
    })).resolves.toEqual({ token: 'link', viewerId: 'real-user' })

    await expect(router.dispatch({
      event: {
        action: 'claimRewardCampaign',
        token: 'link',
        rateTicket: 'ticket',
        userId: 'spoofed',
      },
      callerUid: 'real-user',
    })).resolves.toMatchObject({ userId: 'real-user' })
    expect(service.claim).toHaveBeenCalledWith({
      token: 'link',
      rateTicket: 'ticket',
    }, 'real-user')
  })

  it('匿名领取返回稳定登录错误', async () => {
    const { router } = createHarness()
    await expect(router.dispatch({
      event: { action: 'claimRewardCampaign', token: 'link', rateTicket: 'ticket' },
      callerUid: '',
    })).rejects.toMatchObject({ code: 'login_required', httpStatus: 401 })
  })

  it('内部管理 action 必须验证服务令牌并传递服务端 actor', async () => {
    const { router, assertInternalServiceToken } = createHarness()
    const event = {
      action: 'adminCreateRewardClaimCampaign',
      serviceToken: 'valid-token',
      operator: 'yunyou',
      operatorRole: 'owner',
      campaign: { title: '云乐坊内测感谢礼' },
    }

    await expect(router.dispatch({ event, callerUid: '' })).resolves.toMatchObject({
      actor: { login: 'yunyou', role: 'owner' },
    })
    expect(assertInternalServiceToken).toHaveBeenCalledWith('valid-token')

    await expect(router.dispatch({
      event: { ...event, serviceToken: 'wrong' },
      callerUid: '',
    })).rejects.toThrow(/内部服务鉴权失败/)
  })

  it('预览、发布、生命周期和列表使用明确参数契约', async () => {
    const { router, service } = createHarness()
    const base = {
      serviceToken: 'valid-token',
      operator: 'yunyou',
      operatorRole: 'owner',
    }

    await router.dispatch({
      event: { ...base, action: 'adminPreviewRewardClaimCampaign', campaign: { code: 'one' } },
    })
    await router.dispatch({
      event: {
        ...base,
        action: 'adminPublishRewardClaimCampaign',
        campaignId: 'c1',
        confirmationTitle: '活动',
      },
    })
    await router.dispatch({
      event: {
        ...base,
        action: 'adminChangeRewardClaimCampaignLifecycle',
        campaignId: 'c1',
        lifecycleAction: 'pause',
      },
    })
    await router.dispatch({
      event: { ...base, action: 'adminListRewardClaimCampaigns', skip: 10, limit: 20 },
    })

    expect(service.preview).toHaveBeenCalledWith({ code: 'one' })
    expect(service.publish).toHaveBeenCalledWith('c1', { title: '活动' }, {
      login: 'yunyou',
      role: 'owner',
    })
    expect(service.changeLifecycle).toHaveBeenCalledWith('c1', 'pause', {
      login: 'yunyou',
      role: 'owner',
    })
    expect(service.listCampaigns).toHaveBeenCalledWith({ skip: 10, limit: 20 }, {
      login: 'yunyou',
      role: 'owner',
    })
  })
})
