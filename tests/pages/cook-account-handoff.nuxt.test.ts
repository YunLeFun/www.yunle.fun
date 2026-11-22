// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { getHeader, readBody } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
import CookAccountHandoffPage from '../../app/pages/auth/cook-account.vue'

const h = vi.hoisted(() => ({
  redeem: vi.fn(),
  getSession: vi.fn(),
  signIn: vi.fn(),
  checkAuthStatus: vi.fn(),
  bootstrapFromCookie: vi.fn(),
  router: { afterEach: vi.fn(), beforeEach: vi.fn(), beforeResolve: vi.fn(), replace: vi.fn() },
}))
const user = shallowRef<{ id: string } | null>(null)
const request = 'r'.repeat(43)
const binding = 'b'.repeat(43)
const confirmation = 'c'.repeat(43)

mockNuxtImport('useCloudbase', () => () => ({
  auth: { getSession: h.getSession, signInWithCustomTicket: h.signIn },
}))
mockNuxtImport('useRouter', () => () => h.router)
vi.mock('../../app/composables/auth/useAuthSession', () => ({
  useTcbAuthSession: () => ({ user, checkAuthStatus: h.checkAuthStatus }),
}))
vi.mock('../../app/composables/auth/useServerSession', () => ({
  useServerSession: () => ({ bootstrapFromCookie: h.bootstrapFromCookie }),
}))
registerEndpoint('/api/session/cook-handoff', {
  method: 'POST',
  handler: async event => h.redeem(await readBody(event), getHeader(event, 'authorization')),
})

function browserSession(uid: string) {
  return { data: { session: { access_token: `token-${uid}`, user: { id: uid } } }, error: null }
}

async function mountPage(hash = '') {
  window.history.replaceState(window.history.state, '', `/auth/cook-account?request=${request}&binding=${binding}${hash}`)
  return await mountSuspended(CookAccountHandoffPage, {
    global: { stubs: { AppButton: { template: '<button><slot /></button>' } } },
  })
}

describe('opening the current Cook account website', () => {
  beforeEach(() => {
    useRuntimeConfig().public.cookieSession = false
    user.value = null
    h.redeem.mockReset()
    h.getSession.mockReset().mockResolvedValue({ data: { session: null }, error: null })
    h.signIn.mockReset()
    h.bootstrapFromCookie.mockReset()
    h.router.replace.mockReset()
    h.checkAuthStatus.mockReset().mockImplementation(() => {
      user.value = { id: 'cook-user' }
    })
  })

  it('signs in a fresh browser and opens the fixed management page without prompting', async () => {
    h.redeem.mockResolvedValue({ state: 'issued', subject: 'cook-user', ticket: 'once-ticket' })
    h.signIn.mockImplementation(async (takeTicket: () => Promise<string>) => {
      expect(await takeTicket()).toBe('once-ticket')
      await expect(takeTicket()).rejects.toThrow()
    })
    const wrapper = await mountPage()
    await vi.waitFor(() => expect(h.router.replace).toHaveBeenCalledWith('/settings?tab=account'))
    expect(wrapper.text()).not.toContain('确认切换')
    expect(window.location.search).toBe('')
    expect(h.signIn).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it.each([
    ['', '/settings?tab=account'],
    ['#membership', '/pricing'],
  ])('reuses the same browser login for %s without signing in again', async (hash, destination) => {
    h.getSession.mockResolvedValue(browserSession('cook-user'))
    h.redeem.mockResolvedValue({ state: 'reuse', subject: 'cook-user' })
    const wrapper = await mountPage(hash)
    await vi.waitFor(() => expect(h.router.replace).toHaveBeenCalledWith(destination))
    expect(h.redeem).toHaveBeenCalledWith({ request, confirmation: '' }, 'Bearer token-cook-user')
    expect(h.signIn).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it.each([
    ['#membership', '/pricing'],
    ['#https://example.test/pricing', '/settings?tab=account'],
  ])('opens the fixed destination for %s after signing in a fresh browser', async (hash, destination) => {
    h.redeem.mockResolvedValue({ state: 'issued', subject: 'cook-user', ticket: 'once-ticket' })
    const wrapper = await mountPage(hash)
    await vi.waitFor(() => expect(h.router.replace).toHaveBeenCalledWith(destination))
    expect(h.redeem).toHaveBeenCalledWith({ request, confirmation: '' }, undefined)
    expect(h.signIn).toHaveBeenCalledTimes(1)
    expect(window.location.search + window.location.hash).toBe('')
    wrapper.unmount()
  })

  it('restores a cookie-only website session before opening membership plans', async () => {
    useRuntimeConfig().public.cookieSession = true
    h.getSession.mockResolvedValue({
      data: { session: null },
      error: { code: 'unauthenticated', message: 'credentials not found' },
    })
    h.bootstrapFromCookie.mockImplementation(async () => {
      h.getSession.mockResolvedValue(browserSession('cook-user'))
      return true
    })
    h.redeem.mockResolvedValue({ state: 'reuse', subject: 'cook-user' })
    const wrapper = await mountPage('#membership')
    await vi.waitFor(() => expect(h.router.replace).toHaveBeenCalledWith('/pricing'))
    expect(h.bootstrapFromCookie).toHaveBeenCalledTimes(1)
    expect(h.redeem).toHaveBeenCalledWith({ request, confirmation: '' }, 'Bearer token-cook-user')
    expect(h.signIn).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('signs in when a new browser has never stored CloudBase credentials', async () => {
    h.getSession.mockResolvedValue({
      data: { session: null },
      error: { code: 'unauthenticated', message: 'credentials not found' },
    })
    h.redeem.mockResolvedValue({ state: 'issued', subject: 'cook-user', ticket: 'fresh-ticket' })
    const wrapper = await mountPage('#membership')
    await vi.waitFor(() => expect(h.router.replace).toHaveBeenCalledWith('/pricing'))
    expect(h.redeem).toHaveBeenCalledExactlyOnceWith({ request, confirmation: '' }, undefined)
    expect(h.signIn).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('finishes after CloudBase discards an expired browser SDK session', async () => {
    useRuntimeConfig().public.cookieSession = true
    h.getSession.mockResolvedValueOnce({ data: { session: null }, error: { status: 'unauthenticated' } })
    h.bootstrapFromCookie.mockResolvedValue(false)
    h.redeem.mockResolvedValue({ state: 'issued', subject: 'cook-user', ticket: 'fresh-ticket' })
    const wrapper = await mountPage()
    await vi.waitFor(() => expect(h.router.replace).toHaveBeenCalledWith('/settings?tab=account'))
    expect(h.redeem).toHaveBeenCalledWith({ request, confirmation: '' }, undefined)
    expect(h.signIn).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('does not treat a browser session that remains unreadable as signed out', async () => {
    h.getSession.mockResolvedValue({ data: { session: null }, error: { status: 'temporarily_unavailable' } })
    const wrapper = await mountPage()
    await vi.waitFor(() => expect(wrapper.text()).toContain('暂时无法打开'))
    expect(h.getSession).toHaveBeenCalledTimes(2)
    expect(h.redeem).not.toHaveBeenCalled()
    expect(h.signIn).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it.each(['', '#membership'])('leaves the existing browser account alone when the user declines to switch for %s', async (hash) => {
    h.getSession
      .mockResolvedValueOnce({ data: { session: null }, error: { status: 'unauthenticated' } })
      .mockResolvedValue(browserSession('other-user'))
    h.redeem.mockResolvedValue({ state: 'switch', confirmation })
    const wrapper = await mountPage(hash)
    await vi.waitFor(() => expect(wrapper.text()).toContain('切换网页账号？'))
    await wrapper.findAll('button').find(button => button.text() === '取消')!.trigger('click')
    expect(wrapper.text()).toContain('已保留原来的网页登录状态')
    expect(h.redeem).toHaveBeenCalledTimes(1)
    expect(h.redeem).toHaveBeenCalledWith({ request, confirmation: '' }, 'Bearer token-other-user')
    expect(h.signIn).not.toHaveBeenCalled()
    expect(h.router.replace).not.toHaveBeenCalledWith('/settings?tab=account')
    expect(h.router.replace).not.toHaveBeenCalledWith('/pricing')
    wrapper.unmount()
  })

  it.each([
    ['/settings?tab=account', ''],
    ['/pricing', '#membership'],
  ])('opens %s for a different browser account only after confirmation', async (destination, hash) => {
    h.getSession.mockResolvedValue(browserSession('other-user'))
    h.redeem
      .mockResolvedValueOnce({ state: 'switch', confirmation })
      .mockResolvedValueOnce({ state: 'issued', subject: 'cook-user', ticket: 'switch-ticket' })
    const wrapper = await mountPage(hash)
    await vi.waitFor(() => expect(wrapper.text()).toContain('确认切换'))
    expect(h.signIn).not.toHaveBeenCalled()
    expect(h.router.replace).not.toHaveBeenCalledWith('/settings?tab=account')
    expect(h.router.replace).not.toHaveBeenCalledWith('/pricing')
    await wrapper.findAll('button').find(button => button.text() === '确认切换')!.trigger('click')
    await vi.waitFor(() => expect(h.router.replace).toHaveBeenCalledWith(destination))
    expect(h.redeem).toHaveBeenLastCalledWith({ request, confirmation }, 'Bearer token-other-user')
    expect(h.signIn).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })
})
