// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { usePaymentFlow } from '../app/composables/usePaymentFlow'

const PENDING_KEY = 'test:payment-flow'
const h = vi.hoisted(() => ({
  app: {} as { callFunction: ReturnType<typeof vi.fn> },
  auth: {} as { getSession: ReturnType<typeof vi.fn> },
  onPaid: vi.fn(),
}))

mockNuxtImport('useCloudbase', () => () => ({
  app: h.app,
  auth: h.auth,
}))

const Harness = defineComponent({
  setup() {
    const flow = usePaymentFlow({
      pendingKey: PENDING_KEY,
      onPaid: () => h.onPaid(),
    })
    flow.resume()
    return flow
  },
  template: '<span data-testid="phase">{{ phase }}</span>',
})

describe('payment flow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    sessionStorage.clear()
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({
      outTradeNo: 'YLF-PAID',
      payType: 'native',
      startedAt: Date.now(),
    }))
    h.app = {
      callFunction: vi.fn().mockResolvedValue({
        result: { status: 'paid', transactionId: 'wx-1', paidAt: Date.now() },
      }),
    }
    h.auth = { getSession: vi.fn() }
    h.onPaid = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
    sessionStorage.clear()
  })

  it('does not report success until the refreshed entitlement is visible', async () => {
    let finishRefresh!: () => void
    h.onPaid.mockReturnValue(new Promise<void>((resolve) => {
      finishRefresh = resolve
    }))
    const wrapper = await mountSuspended(Harness)

    await vi.advanceTimersByTimeAsync(5000)
    await flushPromises()

    expect(h.app.callFunction).toHaveBeenCalledWith({
      name: 'wxpay-order',
      data: { action: 'queryOrder', outTradeNo: 'YLF-PAID' },
    })
    expect(wrapper.get('[data-testid="phase"]').text()).toBe('paying')

    finishRefresh()
    await flushPromises()

    expect(wrapper.get('[data-testid="phase"]').text()).toBe('success')
    wrapper.unmount()
  })
})
