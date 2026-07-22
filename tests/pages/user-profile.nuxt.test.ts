// @vitest-environment nuxt
import type { Ref } from 'vue'
import type { UserProfile } from '../../app/types/social'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import UserProfilePage from '../../app/pages/u/[login].vue'

const h = vi.hoisted(() => ({
  useFetch: vi.fn(),
  getProfile: vi.fn(),
  getRelation: vi.fn(),
  getUserApps: vi.fn(),
  refresh: vi.fn(),
  route: { params: { login: '2078850644063563776' } },
  user: undefined as unknown as Ref<{ id: string } | null>,
  fetchData: undefined as unknown as Ref<UserProfile | null>,
  fetchStatus: undefined as unknown as Ref<'idle' | 'pending' | 'success' | 'error'>,
  fetchError: undefined as unknown as Ref<{ statusCode?: number, status?: number } | null>,
}))

mockNuxtImport('useRoute', () => () => h.route)
mockNuxtImport('useFetch', () => (...args: unknown[]) => h.useFetch(...args))
mockNuxtImport('useTcbAuth', () => () => ({ user: h.user }))
mockNuxtImport('useUserProfile', () => () => ({ getProfile: h.getProfile }))
mockNuxtImport('useFollow', () => () => ({ getRelation: h.getRelation }))
mockNuxtImport('useApps', () => () => ({ getUserApps: h.getUserApps }))

const profile: UserProfile = {
  userId: '2078850644063563776',
  login: null,
  nickname: 'raincither',
  avatar: null,
  description: '',
  followersCount: 0,
  followingCount: 1,
  hideFollowers: false,
  hideFollowing: false,
  notifyOnFollow: true,
  isMember: true,
}

function mountPage() {
  return mountSuspended(UserProfilePage, {
    shallow: true,
    global: {
      stubs: {
        UContainer: { template: '<div><slot /></div>' },
        SkyHero: { template: '<section><slot /></section>' },
        UButton: {
          props: ['label'],
          emits: ['click'],
          template: '<button type="button" @click="$emit(\'click\')">{{ label }}</button>',
        },
        MemberAvatar: {
          props: ['isMember'],
          template: '<span data-testid="member-avatar" :data-member="isMember ? \'true\' : \'false\'" />',
        },
      },
    },
  })
}

describe('public user profile page', () => {
  beforeEach(() => {
    h.useFetch.mockReset()
    h.getProfile.mockReset().mockResolvedValue(null)
    h.getRelation.mockReset().mockResolvedValue(null)
    h.getUserApps.mockReset().mockResolvedValue([])
    h.refresh.mockReset().mockResolvedValue(undefined)
    h.user = ref(null)
    h.fetchData = ref(null)
    h.fetchStatus = ref('error')
    h.fetchError = ref({ statusCode: 502 })
    h.useFetch.mockReturnValue({
      data: h.fetchData,
      status: h.fetchStatus,
      error: h.fetchError,
      refresh: h.refresh,
    })
  })

  it('shows a retryable service error instead of claiming the user does not exist', async () => {
    const wrapper = await mountPage()
    await flushPromises()

    expect(wrapper.text()).toContain('暂时无法加载用户资料')
    expect(wrapper.text()).not.toContain('用户不存在')
    expect(h.getProfile).not.toHaveBeenCalled()
  })

  it('shows not found only for an explicit 404 response', async () => {
    h.fetchError.value = { statusCode: 404 }

    const wrapper = await mountPage()
    await flushPromises()

    expect(wrapper.text()).toContain('用户不存在')
    expect(wrapper.text()).not.toContain('暂时无法加载用户资料')
  })

  it('renders a uid-based profile without requiring a CloudBase browser session', async () => {
    h.fetchData.value = profile
    h.fetchStatus.value = 'success'
    h.fetchError.value = null

    const wrapper = await mountPage()
    await flushPromises()

    expect(wrapper.text()).toContain('raincither')
    expect(h.getProfile).not.toHaveBeenCalled()
    const [, options] = h.useFetch.mock.calls[0] as [string, { query: { identifier: Ref<string> } }]
    expect(options.query.identifier.value).toBe(profile.userId)
  })

  it('passes the public membership marker to the profile avatar', async () => {
    h.fetchData.value = profile
    h.fetchStatus.value = 'success'
    h.fetchError.value = null

    const wrapper = await mountPage()
    await flushPromises()

    expect(wrapper.get('[data-testid="member-avatar"]').attributes('data-member')).toBe('true')
  })

  it('retries the same public endpoint after a transient failure', async () => {
    const wrapper = await mountPage()
    await flushPromises()

    await wrapper.get('button').trigger('click')
    expect(h.refresh).toHaveBeenCalledOnce()
  })

  it('loads viewer relation only after the restored user session becomes available', async () => {
    h.fetchData.value = profile
    h.fetchStatus.value = 'success'
    h.fetchError.value = null

    await mountPage()
    await flushPromises()
    expect(h.getRelation).not.toHaveBeenCalled()

    h.user.value = { id: 'viewer-user' }
    await flushPromises()

    expect(h.getRelation).toHaveBeenCalledWith(profile.userId)
  })
})
