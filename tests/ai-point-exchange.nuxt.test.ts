// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, ref } from 'vue'
import { useAiPointExchange } from '../app/composables/useAiPointExchange'

const h = vi.hoisted(() => ({ state: {} as Record<string, any> }))
mockNuxtImport('useCloudbase', () => () => ({ app: { callFunction: h.state.callFunction } }))
mockNuxtImport('useTcbAuth', () => () => ({ user: h.state.user }))
mockNuxtImport('useCoin', () => () => ({ refresh: h.state.refreshCoin }))
const Harness = defineComponent({
  setup() {
    h.state.flow = useAiPointExchange()
    return () => null
  },
})
const result = { exchangeId: 'receipt', coinAmount: 10, creditedMicroPoints: 100_000, coinBalance: 90, account: {}, deduped: false }

describe('aI exchange request lifecycle', () => {
  beforeEach(() => {
    sessionStorage.clear()
    h.state.user = ref({ id: 'user-1' })
    h.state.callFunction = vi.fn()
    h.state.refreshCoin = vi.fn()
  })
  afterEach(() => sessionStorage.clear())

  it('keeps the same idempotency key after a lost response and a component remount', async () => {
    let wrapper = await mountSuspended(Harness)
    h.state.callFunction.mockRejectedValueOnce(new Error('network response lost'))
    expect(await h.state.flow.exchange(10, 10)).toBeNull()
    await flushPromises()
    const firstRequest = h.state.callFunction.mock.calls[0][0]
    expect(h.state.flow.pending.value).toBeTruthy()
    expect(sessionStorage.getItem('wallet-ai-point-exchange')).toContain(firstRequest.data.idempotencyKey)
    wrapper.unmount()
    wrapper = await mountSuspended(Harness)
    h.state.callFunction.mockResolvedValueOnce({ result })
    await h.state.flow.exchange(20, 30)
    expect(h.state.callFunction.mock.calls[1][0]).toEqual(firstRequest)
    expect(h.state.flow.pending.value).toBeNull()
    expect(h.state.refreshCoin).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('blocks duplicate submissions while one is in flight', async () => {
    const wrapper = await mountSuspended(Harness)
    let complete!: (value: unknown) => void
    h.state.callFunction.mockImplementation(() => new Promise(resolve => complete = resolve))
    const first = h.state.flow.exchange(10, 10)
    await h.state.flow.exchange(10, 10)
    expect(h.state.callFunction).toHaveBeenCalledOnce()
    complete({ result })
    await first
    expect(h.state.flow.submitting.value).toBe(false)
    wrapper.unmount()
  })

  it('allows editing again after an explicit rejection, and refreshes the server policy', async () => {
    const wrapper = await mountSuspended(Harness)
    h.state.callFunction.mockResolvedValueOnce({ result: { rejected: true, message: '兑换比例已更新' } })
      .mockResolvedValueOnce({ result: { enabled: true, pointsPerCoin: 20, minCoin: 1, maxCoin: 10_000 } })
    await h.state.flow.exchange(10, 10)
    expect(h.state.flow.pending.value).toBeNull()
    expect(h.state.flow.policy.value.pointsPerCoin).toBe(20)
    expect(h.state.flow.error.value).toBe('兑换比例已更新')
    wrapper.unmount()
  })

  it('does not apply a completed response to a different signed-in user', async () => {
    const wrapper = await mountSuspended(Harness)
    let complete!: (value: unknown) => void
    h.state.callFunction.mockImplementation(() => new Promise(resolve => complete = resolve))
    const first = h.state.flow.exchange(10, 10)
    h.state.user.value = { id: 'user-2' }
    complete({ result })
    expect(await first).toBeNull()
    expect(h.state.refreshCoin).not.toHaveBeenCalled()
    expect(h.state.flow.pending.value).toBeNull()
    wrapper.unmount()
  })
})
