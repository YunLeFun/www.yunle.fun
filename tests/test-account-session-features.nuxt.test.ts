// @vitest-environment nuxt
import type { User } from '../app/composables/auth/types'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, shallowRef } from 'vue'
import { clearNuxtState, useState } from '#app'
import PrivacyTab from '../app/components/settings/PrivacyTab.vue'
import SignInCalendar from '../app/components/SignInCalendar.vue'
import { useSignIn } from '../app/composables/useSignIn'
import { useUserProfile } from '../app/composables/useUserProfile'

const h = vi.hoisted(() => ({ callFunction: vi.fn(), refreshCoin: vi.fn(), toast: vi.fn() }))
const user = shallowRef<User | null>(null)
mockNuxtImport('useCloudbase', () => () => ({ app: { callFunction: h.callFunction } }))
mockNuxtImport('useTcbAuth', () => () => ({ user }))
mockNuxtImport('useCoin', () => () => ({ refresh: h.refreshCoin }))
mockNuxtImport('useAppToast', () => () => ({ add: h.toast }))

let signIn: ReturnType<typeof useSignIn>
let profile: ReturnType<typeof useUserProfile>
const Harness = defineComponent({
  setup() {
    const sharedUser = useState<User | null>('auth_user')
    sharedUser.value = user.value
    profile = useUserProfile()
    signIn = useSignIn()
    return () => null
  },
})
const restricted = { result: { ok: false, code: 'synthetic_action_forbidden', retryable: false } }
const signed = { balance: 21, reward: 1, alreadySigned: false, dateKey: '2026-10-16', isMember: false, currentStreak: 1, longestStreak: 1, weekProgress: 1, weekLen: 7, milestoneReward: 10, milestone: null }
const regularUser = (id: string): User => ({ id, role: 'USER', hasPassword: true, providers: [], identities: [], createdAt: '', updatedAt: '' })

describe('test-account session feature restrictions', () => {
  beforeEach(() => {
    clearNuxtState()
    user.value = regularUser('user-1')
    h.callFunction.mockReset()
    h.refreshCoin.mockReset()
    h.toast.mockReset()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('treats automatic sign-in denial as a shared limitation without retrying, crediting or warning', async () => {
    const wrapper = await mountSuspended(Harness)
    h.callFunction.mockResolvedValue(restricted)
    expect(await signIn.autoClaim()).toBeNull()
    expect(signIn.restricted.value).toBe(true)
    expect(signIn.status.value).toBeNull()
    await signIn.autoClaim()
    await signIn.fetchStatus()
    await signIn.fetchHistory()
    expect(await signIn.signIn()).toBeNull()
    expect(h.callFunction).toHaveBeenCalledOnce()
    expect(h.callFunction).toHaveBeenCalledWith({ name: 'account-api', data: { action: 'signIn', restrictionResponse: 'v1' } })
    expect(h.refreshCoin).not.toHaveBeenCalled()
    expect(console.warn).not.toHaveBeenCalled()
    const calendar = await mountSuspended(SignInCalendar)
    expect(calendar.get('[data-testid="test-account-sign-in"]').attributes('role')).toBe('status')
    expect(calendar.text()).toContain('测试账号暂不支持签到奖励')
    expect(calendar.text()).not.toContain('今日待领取')
    expect(calendar.find('button, [role="img"]').exists()).toBe(false)
    calendar.unmount()
    wrapper.unmount()
  })

  it.each(['fetchStatus', 'fetchHistory'] as const)('recognizes a read restriction from %s', async (method) => {
    const wrapper = await mountSuspended(Harness)
    h.callFunction.mockResolvedValue(restricted)
    await signIn[method]()
    expect(h.callFunction).toHaveBeenCalledWith({ name: 'account-api', data: { action: method === 'fetchStatus' ? 'getSignInStatus' : 'getSignInHistory', restrictionResponse: 'v1' } })
    expect(signIn.restricted.value).toBe(true)
    expect(console.warn).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('keeps a genuine sign-in failure retryable and preserves successful normal-account rewards', async () => {
    const wrapper = await mountSuspended(Harness)
    h.callFunction.mockRejectedValueOnce(new Error('FUNCTIONS_INVOCATION_FAILED'))
    expect(await signIn.autoClaim()).toBeNull()
    expect(signIn.restricted.value).toBe(false)
    expect(console.warn).toHaveBeenCalledOnce()
    h.callFunction.mockResolvedValueOnce({ result: signed })
    expect(await signIn.autoClaim()).toEqual(signed)
    expect(signIn.signedToday.value).toBe(true)
    expect(h.refreshCoin).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('discards a restriction from the previous user and resets shared sign-in state', async () => {
    const wrapper = await mountSuspended(Harness)
    let complete!: (value: unknown) => void
    h.callFunction.mockImplementationOnce(() => new Promise(resolve => complete = resolve))
    const pending = signIn.fetchStatus()
    user.value = regularUser('user-2')
    complete(restricted)
    await pending
    await flushPromises()
    expect(signIn.restricted.value).toBe(false)
    h.callFunction.mockResolvedValueOnce({ result: signed })
    await signIn.autoClaim()
    expect(signIn.signedToday.value).toBe(true)
    user.value = regularUser('user-3')
    await flushPromises()
    expect(signIn.status.value).toBeNull()
    wrapper.unmount()
  })

  it('shares explicit public-profile denial, skips repeated sync and keeps it scoped to the current user', async () => {
    const wrapper = await mountSuspended(Harness)
    h.callFunction.mockResolvedValue(restricted)
    expect(await profile.upsertMyProfile({ nickname: 'test' })).toBeNull()
    expect(h.callFunction).toHaveBeenCalledWith({ name: 'account-api', data: { action: 'upsertMyProfile', profile: { nickname: 'test' }, restrictionResponse: 'v1' } })
    expect(profile.syncRestricted.value).toBe(true)
    await profile.upsertMyProfile({ nickname: 'test' })
    expect(h.callFunction).toHaveBeenCalledOnce()
    expect(console.warn).not.toHaveBeenCalled()
    const nextUser = regularUser('user-2')
    user.value = nextUser
    useState<User | null>('auth_user').value = nextUser
    expect(profile.syncRestricted.value).toBe(false)
    h.callFunction.mockResolvedValueOnce({ result: { userId: nextUser.id, nickname: 'normal' } })
    expect(await profile.upsertMyProfile({ nickname: 'normal' })).toMatchObject({ userId: nextUser.id })
    wrapper.unmount()
  })

  it('continues to warn on a genuine public-profile sync failure', async () => {
    const wrapper = await mountSuspended(Harness)
    h.callFunction.mockRejectedValueOnce(new Error('FUNCTIONS_INVOCATION_FAILED'))
    expect(await profile.upsertMyProfile({ nickname: 'test' })).toBeNull()
    expect(profile.syncRestricted.value).toBe(false)
    expect(console.warn).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('discards a public-profile denial after the user changes', async () => {
    const wrapper = await mountSuspended(Harness)
    let complete!: (value: unknown) => void
    h.callFunction.mockImplementationOnce(() => new Promise(resolve => complete = resolve))
    const pending = profile.upsertMyProfile({ nickname: 'test' })
    useState<User | null>('auth_user').value = regularUser('user-2')
    complete(restricted)
    expect(await pending).toBeNull()
    expect(profile.syncRestricted.value).toBe(false)
    wrapper.unmount()
  })

  it('rolls back a denied privacy update, shows the limitation and disables further edits without a failure toast', async () => {
    const harness = await mountSuspended(Harness)
    h.callFunction.mockResolvedValueOnce({ result: null })
    const wrapper = await mountSuspended(PrivacyTab)
    await flushPromises()
    h.callFunction.mockResolvedValueOnce(restricted)
    await wrapper.get('button[role="switch"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-testid="test-account-profile-sync"]').text()).toContain('登录和账户读取不受影响')
    const switches = wrapper.findAll('button[role="switch"]')
    expect(switches).toHaveLength(3)
    expect(switches.every(item => item.attributes('disabled') !== undefined)).toBe(true)
    expect(switches[0].attributes('aria-checked')).toBe('false')
    expect(h.toast).not.toHaveBeenCalled()
    wrapper.unmount()
    harness.unmount()
  })

  it('shows a retryable save failure for a genuine privacy service outage', async () => {
    const harness = await mountSuspended(Harness)
    h.callFunction.mockResolvedValueOnce({ result: null })
    const wrapper = await mountSuspended(PrivacyTab)
    await flushPromises()
    h.callFunction.mockRejectedValueOnce(new Error('network unavailable'))
    await wrapper.get('button[role="switch"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="test-account-profile-sync"]').exists()).toBe(false)
    expect(wrapper.get('button[role="switch"]').attributes('disabled')).toBeUndefined()
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: '保存失败，请重试', color: 'error' }))
    wrapper.unmount()
    harness.unmount()
  })
})
