// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import WalletPage from '../../app/pages/wallet.vue'

const h = vi.hoisted(() => ({ navigateTo: vi.fn(), rewardHistory: vi.fn() }))

mockNuxtImport('navigateTo', () => h.navigateTo)
mockNuxtImport('useTcbAuth', () => () => ({ user: ref({ id: 'user-1' }) }))
mockNuxtImport('useCoin', () => () => ({
  balance: ref(0),
  membership: ref(null),
  isMember: ref(false),
  reconcileOrders: vi.fn(async () => ({ reconciled: 0, paid: 0 })),
  refresh: vi.fn(async () => undefined),
  listTransactions: vi.fn(async () => ({ items: [], nextSkip: null })),
  listRewardHistory: h.rewardHistory,
  listOrders: vi.fn(async () => ({ items: [], nextSkip: null })),
}))
mockNuxtImport('useCoinRecharge', () => () => ({
  resumePending: vi.fn(() => false),
  phase: ref('idle'),
  selectedCoin: ref(0),
  selectedPrice: ref(0),
  loading: ref(false),
  errorMessage: ref(''),
  currentOrder: ref(null),
  selectPack: vi.fn(),
  selectCustom: vi.fn(),
  createOrder: vi.fn(),
  reset: vi.fn(),
}))

describe('wallet asset navigation', () => {
  beforeEach(() => {
    h.navigateTo.mockReset()
    h.rewardHistory.mockReset().mockResolvedValue({ items: [], nextSkip: null })
  })

  it('shows an account limitation without a service alert or retry control', async () => {
    h.rewardHistory.mockResolvedValue({ items: [], nextSkip: null, restricted: true })
    const wrapper = await mountSuspended(WalletPage, { route: '/wallet' })
    await flushPromises()
    const notice = wrapper.get('[data-testid="test-account-reward-history"]')
    expect(notice.attributes('role')).toBe('status')
    expect(notice.text()).toContain('测试账号暂不支持奖励历史')
    expect(notice.text()).toContain('仍可查看云币余额和明细')
    expect(notice.find('button').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('奖励历史暂时无法加载')
    wrapper.unmount()
  })

  it('keeps an actual reward-service failure retryable without misclassifying the account', async () => {
    h.rewardHistory.mockRejectedValueOnce(new Error('network failed'))
    const wrapper = await mountSuspended(WalletPage, { route: '/wallet' })
    await flushPromises()
    expect(wrapper.find('[data-testid="test-account-reward-history"]').exists()).toBe(false)
    const alert = wrapper.findAll('[role="alert"]').find(item => item.text().includes('奖励历史暂时无法加载'))!
    expect(alert.exists()).toBe(true)
    h.rewardHistory.mockResolvedValue({ items: [], nextSkip: null })
    await alert.get('button').trigger('click')
    await flushPromises()
    expect(h.rewardHistory).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).not.toContain('奖励历史暂时无法加载')
    wrapper.unmount()
  })

  it('deep-links to AI points and preserves a compact route-backed asset switch', async () => {
    const wrapper = await mountSuspended(WalletPage, {
      route: '/wallet?asset=ai-points',
      global: {
        stubs: {
          WalletAiPointsPanel: { template: '<section data-testid="ai-points-panel">AI 资产面板</section>' },
        },
      },
    })
    await flushPromises()

    expect(wrapper.get('[data-testid="ai-points-panel"]').text()).toContain('AI 资产面板')
    expect(wrapper.text()).toContain('管理 AI 点数，用云币为创作补充能量')
    expect(wrapper.text()).not.toContain('云币充值')

    await wrapper.get('[data-testid="wallet-asset-coin"]').trigger('click')
    await flushPromises()
    expect(h.navigateTo).toHaveBeenCalledWith({ path: '/wallet', query: {} }, { replace: true })
  })
})
