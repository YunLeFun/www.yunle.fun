// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, shallowRef } from 'vue'
import { clearNuxtState } from '#app'
import NotificationBell from '../app/components/NotificationBell.vue'
import NotificationModal from '../app/components/NotificationModal.vue'
import { useNotifications } from '../app/composables/useNotifications'

const h = vi.hoisted(() => ({ callFunction: vi.fn() }))
const user = shallowRef<{ id: string } | null>(null)
mockNuxtImport('useCloudbase', () => () => ({ app: { callFunction: h.callFunction } }))
mockNuxtImport('useTcbAuth', () => () => ({ user }))
let flow: ReturnType<typeof useNotifications>
const Harness = defineComponent({
  setup() {
    flow = useNotifications()
    return () => null
  },
})
const modalStub = { props: ['open'], template: '<div v-if="open" role="dialog"><slot name="content" /></div>' }
const restriction = { result: { ok: false, code: 'synthetic_action_forbidden', retryable: false } }

describe('notification capability restrictions', () => {
  beforeEach(() => {
    clearNuxtState()
    user.value = { id: 'user-1' }
    h.callFunction.mockReset()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('shares the unread restriction with the bell and modal without a badge, extra requests or failure warnings', async () => {
    const harness = await mountSuspended(Harness)
    flow.unread.value = 5
    h.callFunction.mockResolvedValue(restriction)
    await flow.refreshUnread()
    expect(flow.restricted.value).toBe(true)
    expect(flow.unread.value).toBe(0)
    expect(h.callFunction).toHaveBeenCalledWith({ name: 'account-api', data: { action: 'getUnreadCount', restrictionResponse: 'v1' } })
    const bell = await mountSuspended(NotificationBell, { global: { stubs: { AppModal: modalStub } } })
    await bell.get('[data-testid="notification-bell"]').trigger('click')
    await flushPromises()
    expect(bell.get('[data-testid="test-account-notifications"]').attributes('role')).toBe('status')
    expect(bell.text()).toContain('测试账号暂不支持站内通知')
    expect(bell.text()).not.toContain('还没有通知')
    expect(bell.find('[data-testid="notification-unread-count"]').exists()).toBe(false)
    await flow.markRead()
    expect(h.callFunction).toHaveBeenCalledOnce()
    expect(console.warn).not.toHaveBeenCalled()
    bell.unmount()
    harness.unmount()
  })

  it('handles a list restriction if the modal opens before unread count is known', async () => {
    const harness = await mountSuspended(Harness)
    flow.unread.value = 5
    const modal = await mountSuspended(NotificationModal, { props: { open: false }, global: { stubs: { AppModal: modalStub } } })
    h.callFunction.mockResolvedValue(restriction)
    await modal.setProps({ open: true })
    await flushPromises()
    expect(modal.get('[data-testid="test-account-notifications"]').text()).toContain('通知未读数')
    expect(modal.find('[role="alert"]').exists()).toBe(false)
    expect(h.callFunction).toHaveBeenCalledOnce()
    expect(h.callFunction.mock.calls[0][0].data).toMatchObject({ action: 'listNotifications', restrictionResponse: 'v1' })
    modal.unmount()
    harness.unmount()
  })

  it('does not treat a rejected mark-read operation as successful', async () => {
    const harness = await mountSuspended(Harness)
    flow.unread.value = 5
    h.callFunction.mockResolvedValue(restriction)
    expect(await flow.markRead(['notification-1'])).toBe(false)
    expect(flow.restricted.value).toBe(true)
    expect(console.warn).not.toHaveBeenCalled()
    harness.unmount()
  })

  it('keeps normal-account unread counts and successful mark-read behavior', async () => {
    const harness = await mountSuspended(Harness)
    h.callFunction.mockResolvedValueOnce({ result: { unread: 3 } })
    await flow.refreshUnread()
    expect(flow.unread.value).toBe(3)
    expect(flow.restricted.value).toBe(false)
    h.callFunction.mockResolvedValueOnce({ result: { ok: true } })
    expect(await flow.markRead(['notification-1'])).toBe(true)
    expect(flow.unread.value).toBe(2)
    harness.unmount()
  })

  it('preserves unread state and warns on real failures instead of classifying them as restrictions', async () => {
    const harness = await mountSuspended(Harness)
    flow.unread.value = 4
    h.callFunction.mockRejectedValue(new Error('FUNCTIONS_INVOCATION_FAILED'))
    await flow.refreshUnread()
    expect(flow.restricted.value).toBe(false)
    expect(flow.unread.value).toBe(4)
    await expect(flow.markRead()).rejects.toThrow('FUNCTIONS_INVOCATION_FAILED')
    expect(flow.unread.value).toBe(4)
    expect(console.warn).toHaveBeenCalledTimes(2)
    harness.unmount()
  })

  it('renders a genuine list failure with retry, then shows empty state only after a successful response', async () => {
    const harness = await mountSuspended(Harness)
    const modal = await mountSuspended(NotificationModal, { props: { open: false }, global: { stubs: { AppModal: modalStub } } })
    h.callFunction.mockRejectedValueOnce(new Error('network unavailable'))
    await modal.setProps({ open: true })
    await flushPromises()
    expect(modal.get('[role="alert"]').text()).toContain('通知暂时无法加载')
    expect(modal.text()).not.toContain('还没有通知')
    h.callFunction.mockResolvedValueOnce({ result: { items: [], nextSkip: null } })
    await modal.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(modal.find('[role="alert"]').exists()).toBe(false)
    expect(modal.text()).toContain('还没有通知')
    modal.unmount()
    harness.unmount()
  })

  it('ignores a stale unread restriction after switching accounts', async () => {
    const harness = await mountSuspended(Harness)
    flow.unread.value = 5
    let complete!: (value: unknown) => void
    h.callFunction.mockImplementationOnce(() => new Promise(resolve => complete = resolve))
    const pending = flow.refreshUnread()
    user.value = { id: 'user-2' }
    complete(restriction)
    await pending
    await flushPromises()
    expect(flow.restricted.value).toBe(false)
    expect(flow.unread.value).toBe(0)
    h.callFunction.mockResolvedValueOnce({ result: { unread: 2 } })
    await flow.refreshUnread()
    expect(flow.unread.value).toBe(2)
    harness.unmount()
  })

  it('does not display the previous account notification when its delayed list finishes', async () => {
    const harness = await mountSuspended(Harness)
    const modal = await mountSuspended(NotificationModal, { props: { open: false }, global: { stubs: { AppModal: modalStub } } })
    let complete!: (value: unknown) => void
    h.callFunction.mockImplementationOnce(() => new Promise(resolve => complete = resolve))
    await modal.setProps({ open: true })
    h.callFunction.mockResolvedValueOnce({ result: { items: [], nextSkip: null } })
    user.value = { id: 'user-2' }
    await flushPromises()
    complete({ result: { items: [{ id: 'old', type: 'follow', read: false, createdAt: 1, actor: { userId: 'old-user', login: 'old', nickname: 'Previous account', avatar: null, isMember: false } }], nextSkip: null } })
    await flushPromises()
    expect(modal.text()).not.toContain('Previous account')
    expect(modal.text()).toContain('还没有通知')
    expect(h.callFunction.mock.calls.every(([request]) => request.data.action === 'listNotifications')).toBe(true)
    modal.unmount()
    harness.unmount()
  })
})
