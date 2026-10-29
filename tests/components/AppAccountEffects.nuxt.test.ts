// @vitest-environment nuxt
import type { VueWrapper } from '@vue/test-utils'
import type { Ref } from 'vue'
import { mockComponent, mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive, ref } from 'vue'
import App from '../../app/app.vue'

const h = vi.hoisted(() => ({
  state: {} as Record<string, any>,
}))

mockNuxtImport('useRoute', () => () => h.state.route)
mockNuxtImport('useColorMode', () => () => ({ value: 'light' }))
mockNuxtImport('useCloudCollection', () => () => ({ milestone: h.state.milestone }))
mockNuxtImport('useAppToast', () => () => ({ add: h.state.toastAdd }))

mockComponent('OnboardingModal', {
  template: '<div data-testid="onboarding" />',
})

vi.mock('~/composables/useSignIn', async () => {
  h.state.importStarted()
  await h.state.importGate
  return { useSignIn: () => ({ autoClaim: h.state.autoClaim }) }
})

function reward(reward = 1) {
  return { reward, currentStreak: 1, alreadySigned: false, milestone: null }
}

let wrapper: VueWrapper | undefined
let user: Ref<{ id: string } | null>

async function mount() {
  wrapper = await mountSuspended(App, {
    global: {
      stubs: {
        NuxtLayout: { template: '<div><slot /></div>' },
        NuxtPage: true,
        NuxtLoadingIndicator: true,
        AppToaster: true,
        ClientOnly: { template: '<slot />' },
        LazyOnboardingModal: { template: '<div data-testid="onboarding" />' },
        LazyCloudCollectorBadge: true,
      },
    },
  })
  await nextTick()
  return wrapper
}

async function settle() {
  await flushPromises()
  await nextTick()
}

beforeEach(() => {
  h.state.route = reactive({ path: '/login', meta: { layout: 'auth' } })
  h.state.milestone = ref(null)
  h.state.toastAdd = vi.fn()
  h.state.autoClaim = vi.fn().mockResolvedValue(reward())
  h.state.importStarted = vi.fn()
  h.state.importGate = Promise.resolve()
  user = useState<{ id: string } | null>('auth_user', () => null)
  user.value = null
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})

describe('application account effects', () => {
  it('rechecks the route after the sign-in module loads before sending a request', async () => {
    let finishImport!: () => void
    h.state.importGate = new Promise<void>((resolve) => {
      finishImport = resolve
    })
    h.state.route.meta.layout = 'default'
    user.value = { id: 'user-a' }
    await mount()
    await vi.waitFor(() => expect(h.state.importStarted).toHaveBeenCalledOnce())

    h.state.route.meta.layout = 'auth'
    await nextTick()
    finishImport()
    await settle()

    expect(h.state.autoClaim).not.toHaveBeenCalled()
    expect(h.state.toastAdd).not.toHaveBeenCalled()
    expect(wrapper?.find('[data-testid="onboarding"]').exists()).toBe(false)

    h.state.route.meta.layout = 'default'
    await settle()

    expect(h.state.autoClaim).toHaveBeenCalledOnce()
    expect(h.state.toastAdd).toHaveBeenCalledOnce()
    expect(wrapper?.find('[data-testid="onboarding"]').exists()).toBe(true)
  })

  it('defers recovered-account effects until the user leaves the auth layout', async () => {
    await mount()
    user.value = { id: 'user-a' }
    await settle()

    expect(h.state.autoClaim).not.toHaveBeenCalled()
    expect(h.state.toastAdd).not.toHaveBeenCalled()
    expect(wrapper?.find('[data-testid="onboarding"]').exists()).toBe(false)

    h.state.route.meta.layout = 'default'
    h.state.route.path = '/profile'
    await settle()

    expect(h.state.autoClaim).toHaveBeenCalledOnce()
    expect(h.state.toastAdd).toHaveBeenCalledWith(expect.objectContaining({ title: '每日 +1 云币已到账' }))
    expect(wrapper?.find('[data-testid="onboarding"]').exists()).toBe(true)
  })

  it('does not launch effects when an authenticated user initially opens authorization', async () => {
    user.value = { id: 'user-a' }
    await mount()
    await settle()

    expect(h.state.autoClaim).not.toHaveBeenCalled()
    expect(h.state.toastAdd).not.toHaveBeenCalled()
    expect(wrapper?.find('[data-testid="onboarding"]').exists()).toBe(false)
  })

  it('claims once when an already authenticated normal page mounts', async () => {
    h.state.route.meta.layout = 'default'
    user.value = { id: 'user-a' }
    await mount()
    await settle()

    expect(h.state.autoClaim).toHaveBeenCalledOnce()
    expect(h.state.toastAdd).toHaveBeenCalledOnce()
  })

  it('suppresses an in-flight reward toast after entering authorization', async () => {
    let finishClaim!: (value: ReturnType<typeof reward>) => void
    h.state.autoClaim.mockReturnValue(new Promise<ReturnType<typeof reward>>((resolve) => {
      finishClaim = resolve
    }))
    h.state.route.meta.layout = 'default'
    user.value = { id: 'user-a' }
    await mount()
    await settle()
    expect(h.state.autoClaim).toHaveBeenCalledOnce()

    h.state.route.meta.layout = 'auth'
    await nextTick()
    finishClaim(reward())
    await settle()

    expect(h.state.toastAdd).not.toHaveBeenCalled()
    expect(wrapper?.find('[data-testid="onboarding"]').exists()).toBe(false)
  })

  it('discards an old account reward while allowing the new account effects', async () => {
    let finishOldClaim!: (value: ReturnType<typeof reward>) => void
    h.state.autoClaim.mockReturnValueOnce(new Promise<ReturnType<typeof reward>>((resolve) => {
      finishOldClaim = resolve
    }))
    h.state.route.meta.layout = 'default'
    user.value = { id: 'user-a' }
    await mount()
    await settle()

    user.value = { id: 'user-b' }
    await settle()
    expect(h.state.autoClaim).toHaveBeenCalledTimes(2)
    expect(h.state.toastAdd).toHaveBeenCalledOnce()

    finishOldClaim(reward(99))
    await settle()
    expect(h.state.toastAdd).toHaveBeenCalledOnce()

    user.value = null
    await settle()
    expect(h.state.autoClaim).toHaveBeenCalledTimes(2)
    expect(wrapper?.find('[data-testid="onboarding"]').exists()).toBe(false)
  })
})
