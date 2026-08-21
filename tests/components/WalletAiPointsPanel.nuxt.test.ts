// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readonly, ref } from 'vue'
import WalletAiPointsPanel from '../../app/components/wallet/WalletAiPointsPanel.vue'

const h = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))

mockNuxtImport('useAiPoints', () => () => h.state.composable)

describe('wallet AI points panel', () => {
  beforeEach(() => {
    h.state.composable = {
      account: readonly(ref({
        initialized: true,
        availableMicroPoints: 88_000,
        reservedMicroPoints: 12_000,
        activeReservationCount: 2,
        lifetimeGrantedMicroPoints: 100_000,
        lifetimeChargedMicroPoints: 12_000,
        updatedAt: Date.parse('2026-08-18T10:00:00+08:00'),
      })),
      transactions: readonly(ref([{
        id: 'tx_1',
        type: 'settle',
        appId: 'advjs-studio',
        scope: 'studio-managed-ai',
        taskId: 'task_1',
        availableDelta: 18_000,
        reservedDelta: -30_000,
        chargedMicroPoints: 12_000,
        availableAfter: 88_000,
        reservedAfter: 0,
        createdAt: Date.parse('2026-08-18T10:00:00+08:00'),
      }])),
      loading: readonly(ref(false)),
      loadingMore: readonly(ref(false)),
      error: readonly(ref<string | null>(null)),
      hasMore: readonly(ref(true)),
      refresh: vi.fn(async () => undefined),
      loadMore: vi.fn(async () => undefined),
    }
  })

  it('shows formatted balances and a user-facing immutable ledger', async () => {
    const wrapper = await mountSuspended(WalletAiPointsPanel)
    await flushPromises()

    expect(wrapper.text()).toContain('88')
    expect(wrapper.text()).toContain('12')
    expect(wrapper.text()).toContain('累计使用')
    expect(wrapper.text()).toContain('任务结算')
    expect(wrapper.text()).toContain('ADV.JS Studio')
    expect(wrapper.text()).not.toContain('microPoints')
    expect(wrapper.text()).not.toContain('task_1')

    const loadMore = wrapper.findAll('button').find(button => button.text().includes('加载更多'))
    expect(loadMore).toBeTruthy()
    await loadMore!.trigger('click')
    expect((h.state.composable as { loadMore: ReturnType<typeof vi.fn> }).loadMore).toHaveBeenCalledOnce()
  })

  it('explains an account that has not received AI points without implying a recharge path', async () => {
    const composable = h.state.composable as {
      account: ReturnType<typeof readonly>
      transactions: ReturnType<typeof readonly>
    }
    composable.account = readonly(ref({
      initialized: false,
      availableMicroPoints: 0,
      reservedMicroPoints: 0,
      activeReservationCount: 0,
      lifetimeGrantedMicroPoints: 0,
      lifetimeChargedMicroPoints: 0,
      updatedAt: null,
    }))
    composable.transactions = readonly(ref([]))

    const wrapper = await mountSuspended(WalletAiPointsPanel)
    await flushPromises()

    expect(wrapper.text()).toContain('尚未获得 AI 点数')
    expect(wrapper.text()).toContain('由接入统一账本的 AI 应用按规则发放和扣除')
    expect(wrapper.text()).not.toContain('充值 AI 点数')
  })
})
