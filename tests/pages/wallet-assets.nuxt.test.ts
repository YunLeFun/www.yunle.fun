// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import WalletPage from '../../app/pages/wallet.vue'

const h = vi.hoisted(() => ({ navigateTo: vi.fn() }))

mockNuxtImport('navigateTo', () => h.navigateTo)
mockNuxtImport('useTcbAuth', () => () => ({ user: ref({ id: 'user-1' }) }))
mockNuxtImport('useCoin', () => () => ({
  balance: ref(0),
  membership: ref(null),
  isMember: ref(false),
  reconcileOrders: vi.fn(async () => ({ reconciled: 0, paid: 0 })),
  refresh: vi.fn(async () => undefined),
  listTransactions: vi.fn(async () => ({ items: [], nextSkip: null })),
  listRewardHistory: vi.fn(async () => ({ items: [], nextSkip: null })),
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
  beforeEach(() => h.navigateTo.mockReset())

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
    expect(wrapper.text()).toContain('查看你的 AI 点数余额与不可变流水')
    expect(wrapper.text()).not.toContain('云币充值')

    await wrapper.get('[data-testid="wallet-asset-coin"]').trigger('click')
    await flushPromises()
    expect(h.navigateTo).toHaveBeenCalledWith({ path: '/wallet', query: {} }, { replace: true })
  })
})
