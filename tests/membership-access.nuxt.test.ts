// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { expect, it, vi } from 'vitest'
import { defineComponent, ref } from 'vue'
import { useMembership } from '../app/composables/useMembership'

const h = vi.hoisted(() => ({ callFunction: vi.fn() }))
const user = ref<{ id: string } | null>({ id: 'alice' })
mockNuxtImport('useCloudbase', () => () => ({ app: { callFunction: h.callFunction } }))
mockNuxtImport('useTcbAuth', () => () => ({ user }))

it('shows the Play access date in the member view and keeps the paid date for renewal quotes', async () => {
  const paidExpireAt = Date.now() - 20_000
  const accessExpireAt = Date.now() + 86_400_000
  const paidRecord = { _id: 'alice', planId: 'basic', activeCycle: 'month', expireAt: paidExpireAt }
  h.callFunction.mockResolvedValueOnce({ result: { ...paidRecord, accessExpireAt } })
  h.callFunction.mockResolvedValueOnce({ result: paidRecord })
  let membership!: ReturnType<typeof useMembership>
  const wrapper = await mountSuspended(defineComponent({
    setup() {
      membership = useMembership()
      return () => null
    },
  }))

  try {
    await membership.refresh()
    expect(membership.record.value?.expireAt).toBe(paidExpireAt)
    expect(membership.state.value).toMatchObject({ expireAt: accessExpireAt, paidExpireAt, active: true })
    expect(membership.isActive.value).toBe(true)

    await membership.refresh()
    expect(membership.state.value).toMatchObject({ expireAt: paidExpireAt, paidExpireAt, active: false })
    expect(membership.isActive.value).toBe(false)
  }
  finally {
    membership.clear()
    wrapper.unmount()
  }
})
