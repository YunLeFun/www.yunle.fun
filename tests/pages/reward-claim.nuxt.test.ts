// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import RewardClaimPage from '../../app/pages/claim/index.vue'

const h = vi.hoisted(() => ({
  state: {} as Record<string, any>,
}))

mockNuxtImport('useRewardClaim', () => () => ({
  inspect: h.state.inspect,
  claim: h.state.claim,
  loading: ref(false),
  claiming: ref(false),
}))

vi.mock('~/composables/auth/useAuthSession', () => ({
  useTcbAuthSession: () => ({
    authReady: h.state.authReady,
    user: h.state.user,
    isAuthenticated: computed(() => !!h.state.user.value),
    checkAuthStatus: h.state.checkAuthStatus,
  }),
}))

const activeCampaign = {
  availability: 'active',
  campaign: {
    title: '云乐坊内测感谢礼',
    description: '感谢参与云乐坊内测，领取一份云币礼遇。',
    reward: { coinAmount: 100, membershipDays: 0 },
    claimLimit: 1,
    startsAt: Date.UTC(2026, 6, 24, 2),
    endsAt: Date.UTC(2026, 6, 31, 2),
    rewardExpires: false,
  },
  viewer: { authenticated: false },
}

async function mountPage() {
  const wrapper = await mountSuspended(RewardClaimPage, {
    route: '/claim#abcdefghijklmnopqrstuvwxyz1234567890ABCDEFG',
  })
  await flushPromises()
  return wrapper
}

describe('共享权益领取页', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.state.inspect = vi.fn().mockResolvedValue(structuredClone(activeCampaign))
    h.state.claim = vi.fn().mockResolvedValue({
      claimId: 'claim-1',
      grantId: 'grant-1',
      status: 'succeeded',
      balanceAfter: 180,
      claimedAt: Date.UTC(2026, 6, 24, 3),
    })
    h.state.authReady = ref(true)
    h.state.user = ref<{ id: string } | null>(null)
    h.state.checkAuthStatus = vi.fn(async () => undefined)
  })

  it('向访客展示活动信息和登录入口，但不公开精确剩余库存', async () => {
    const wrapper = await mountPage()

    expect(wrapper.text()).toContain('云乐坊内测感谢礼')
    expect(wrapper.text()).toContain('100 云币')
    expect(wrapper.text()).not.toContain('剩余 50 份')
    expect(wrapper.text()).toContain('每个账户限领一次')
    expect(wrapper.text()).toContain('领取后长期有效')
    expect(wrapper.get('a[href^="/login?redirect="]').attributes('href'))
      .toBe('/login?redirect=%2Fclaim%23abcdefghijklmnopqrstuvwxyz1234567890ABCDEFG')
    expect(h.state.claim).not.toHaveBeenCalled()
  })

  it('已登录用户仍需主动点击，点击时只提交链接令牌', async () => {
    h.state.user.value = { id: 'user-1' }
    h.state.inspect.mockResolvedValue({
      ...structuredClone(activeCampaign),
      viewer: { authenticated: true },
    })
    const wrapper = await mountPage()

    expect(h.state.claim).not.toHaveBeenCalled()
    await wrapper.get('[data-testid="claim-button"]').trigger('click')
    await flushPromises()

    expect(h.state.claim).toHaveBeenCalledTimes(1)
    expect(h.state.claim).toHaveBeenCalledWith('abcdefghijklmnopqrstuvwxyz1234567890ABCDEFG')
    expect(wrapper.text()).toContain('领取成功')
    expect(wrapper.text()).toContain('当前余额 180 云币')
  })

  it('处理中状态不诱导重复领取，不可用链接不泄露活动信息', async () => {
    h.state.user.value = { id: 'user-1' }
    h.state.inspect
      .mockResolvedValueOnce({
        ...structuredClone(activeCampaign),
        viewer: {
          authenticated: true,
          claim: {
            claimId: 'claim-1',
            grantId: 'grant-1',
            status: 'processing',
          },
        },
      })
      .mockResolvedValueOnce({
        availability: 'unavailable',
        viewer: { authenticated: true },
      })

    const processing = await mountPage()
    expect(processing.text()).toContain('正在确认到账')
    expect(processing.find('[data-testid="claim-button"]').exists()).toBe(false)

    processing.unmount()
    const unavailable = await mountPage()
    expect(unavailable.text()).toContain('领取链接不可用')
    expect(unavailable.text()).not.toContain('云乐坊内测感谢礼')
  })

  it('明确失败后允许用户复用原领取记录重试', async () => {
    h.state.user.value = { id: 'user-1' }
    h.state.inspect.mockResolvedValue({
      ...structuredClone(activeCampaign),
      viewer: {
        authenticated: true,
        claim: {
          claimId: 'claim-1',
          grantId: 'grant-1',
          status: 'failed',
          retryable: true,
        },
      },
    })

    const wrapper = await mountPage()
    expect(wrapper.get('[data-testid="claim-button"]').text()).toContain('重新领取')
    await wrapper.get('[data-testid="claim-button"]').trigger('click')
    await flushPromises()
    expect(h.state.claim).toHaveBeenCalledTimes(1)
  })
})
