// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import WalletAiPointExchange from '../../app/components/wallet/WalletAiPointExchange.vue'

const h = vi.hoisted(() => ({ state: {} as Record<string, any> }))
mockNuxtImport('useCoin', () => () => h.state.coin)
mockNuxtImport('useAiPointExchange', () => () => h.state.exchange)

async function mount() {
  return mountSuspended(WalletAiPointExchange, {
    props: { availableMicroPoints: 88_000 },
    global: { stubs: { AppModal: { props: ['open'], template: '<div v-if="open" role="dialog"><slot /></div>' } } },
  })
}

describe('aI point exchange form', () => {
  beforeEach(() => {
    h.state.coin = { account: ref({ coin: 250 }), balance: ref(250), loading: ref(false), error: ref(null), refresh: vi.fn() }
    h.state.exchange = {
      policy: ref({ enabled: true, pointsPerCoin: 10, minCoin: 1, maxCoin: 10_000 }),
      pending: ref(null),
      loading: ref(false),
      submitting: ref(false),
      error: ref(''),
      refresh: vi.fn(),
      exchange: vi.fn(),
    }
  })

  it('previews presets, balances and only sends the reviewed amount after confirmation', async () => {
    const wrapper = await mount()
    await wrapper.findAll('button').find(button => button.text() === '50 云币')!.trigger('click')
    expect(wrapper.get('output').text()).toContain('500')
    expect(wrapper.text()).toContain('兑换后可用 588 点')
    await wrapper.get('form').trigger('submit')
    expect(h.state.exchange.exchange).not.toHaveBeenCalled()
    expect(wrapper.get('[role="dialog"]').text()).toContain('50 云币')
    await wrapper.get('input').setValue('100')
    h.state.exchange.exchange.mockResolvedValue({ exchangeId: 'receipt-1', coinAmount: 50, creditedMicroPoints: 500_000, coinBalance: 200 })
    await wrapper.findAll('button').find(button => button.text() === '确认兑换')!.trigger('click')
    await flushPromises()
    expect(h.state.exchange.exchange).toHaveBeenCalledWith(50, 10)
    expect(wrapper.text()).toContain('500 AI 点数已到账')
    expect(wrapper.emitted('exchanged')).toHaveLength(1)
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })

  it('validates integer amounts and insufficient balance, with a recharge link', async () => {
    const wrapper = await mount()
    await wrapper.get('input').setValue('1.5')
    expect(wrapper.text()).toContain('请输入整数云币数量')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    await wrapper.get('input').setValue('300')
    expect(wrapper.text()).toContain('还差 50 云币')
    expect(wrapper.get('a[href="/wallet"]').text()).toBe('充值云币')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    await wrapper.findAll('button').find(button => button.text() === '全部可用')!.trigger('click')
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('250')
    expect(wrapper.get('output').text()).toContain('2,500')
  })

  it('keeps a pending retry available even when the current policy is unavailable', async () => {
    h.state.exchange.policy.value = null
    h.state.exchange.pending.value = { coinAmount: 10, pointsPerCoin: 10, idempotencyKey: 'same-request' }
    const wrapper = await mount()
    await wrapper.findAll('button').find(button => button.text() === '重试本次兑换')!.trigger('click')
    expect(wrapper.get('[role="dialog"]').text()).toContain('10 云币')
    h.state.exchange.exchange.mockResolvedValue(null)
    await wrapper.get('[role="dialog"]').findAll('button').find(button => button.text() === '重试本次兑换')!.trigger('click')
    expect(h.state.exchange.exchange).toHaveBeenCalledWith(10, 10)
    expect(wrapper.emitted('exchanged')).toBeUndefined()
  })
})
