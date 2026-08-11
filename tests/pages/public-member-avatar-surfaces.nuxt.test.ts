// @vitest-environment nuxt
import type { Ref } from 'vue'
import type { FeedItem, FollowListItem, NotificationItem } from '../../app/types/social'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import FollowListModal from '../../app/components/FollowListModal.vue'
import NotificationModal from '../../app/components/NotificationModal.vue'
import FeedPage from '../../app/pages/feed.vue'

const h = vi.hoisted(() => ({
  getFollowingFeed: vi.fn(),
  listFollowers: vi.fn(),
  listFollowing: vi.fn(),
  listNotifications: vi.fn(),
  markRead: vi.fn(),
  unread: undefined as unknown as Ref<number>,
}))

mockNuxtImport('useFeed', () => () => ({
  getFollowingFeed: h.getFollowingFeed,
}))
mockNuxtImport('useFollow', () => () => ({
  listFollowers: h.listFollowers,
  listFollowing: h.listFollowing,
}))
mockNuxtImport('useNotifications', () => () => ({
  list: h.listNotifications,
  markRead: h.markRead,
  unread: h.unread,
}))

const memberAvatarStub = {
  props: ['isMember'],
  template: '<span data-testid="member-avatar" :data-member="isMember ? \'true\' : \'false\'" />',
}

const commonStubs = {
  AppContainer: { template: '<div><slot /></div>' },
  NuxtLink: { props: ['to'], template: '<a><slot /></a>' },
  MemberAvatar: memberAvatarStub,
}

describe('public membership avatar surfaces', () => {
  beforeEach(() => {
    h.getFollowingFeed.mockReset()
    h.listFollowers.mockReset()
    h.listFollowing.mockReset()
    h.listNotifications.mockReset()
    h.markRead.mockReset()
    h.unread = ref(0)
  })

  it('marks an active member author in the following feed', async () => {
    const item: FeedItem = {
      type: 'app',
      appId: 'app-1',
      slug: 'member-app',
      name: 'Member App',
      icon: '',
      description: '',
      owner: {
        userId: 'member-1',
        login: 'member',
        nickname: 'Member',
        avatar: null,
        isMember: true,
      },
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    }
    h.getFollowingFeed.mockResolvedValue({ items: [item], nextSkip: null })

    const wrapper = await mountSuspended(FeedPage, {
      shallow: true,
      global: { stubs: commonStubs },
    })
    await flushPromises()

    expect(wrapper.get('[data-testid="member-avatar"]').attributes('data-member')).toBe('true')
  })

  it('marks an active member in following and follower lists', async () => {
    const item: FollowListItem = {
      userId: 'member-1',
      login: 'member',
      nickname: 'Member',
      avatar: null,
      followersCount: 1,
      followingCount: 1,
      isMember: true,
      isFollowing: false,
      followedAt: 1_700_000_000_000,
    }
    h.listFollowing.mockResolvedValue({ items: [item], nextSkip: null })

    const wrapper = await mountSuspended(FollowListModal, {
      props: { userId: 'owner-1', type: 'following', open: false },
      shallow: true,
      global: {
        stubs: {
          ...commonStubs,
          AppModal: { template: '<div><slot name="content" /><slot /></div>' },
          FollowButton: true,
        },
      },
    })
    await wrapper.setProps({ open: true })
    await flushPromises()

    expect(wrapper.get('[data-testid="member-avatar"]').attributes('data-member')).toBe('true')
  })

  it('marks an active member actor in follow notifications', async () => {
    const item: NotificationItem = {
      id: 'notification-1',
      type: 'follow',
      read: false,
      createdAt: 1_700_000_000_000,
      actor: {
        userId: 'member-1',
        login: 'member',
        nickname: 'Member',
        avatar: null,
        isMember: true,
      },
    }
    h.listNotifications.mockResolvedValue({ items: [item], nextSkip: null })

    const wrapper = await mountSuspended(NotificationModal, {
      props: { open: false },
      shallow: true,
      global: {
        stubs: {
          ...commonStubs,
          AppModal: { template: '<div><slot name="content" /><slot /></div>' },
        },
      },
    })
    await wrapper.setProps({ open: true })
    await flushPromises()

    expect(wrapper.get('[data-testid="member-avatar"]').attributes('data-member')).toBe('true')
  })
})
