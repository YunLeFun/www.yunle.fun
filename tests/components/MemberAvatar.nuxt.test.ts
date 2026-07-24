// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MemberAvatar from '../../app/components/MemberAvatar.vue'

const h = vi.hoisted(() => ({
  createSignedUrl: vi.fn(),
}))

mockNuxtImport('useCloudbase', () => () => ({
  app: {
    storage: {
      from: () => ({ createSignedUrl: h.createSignedUrl }),
    },
  },
}))

describe('memberAvatar', () => {
  beforeEach(() => {
    h.createSignedUrl.mockReset()
  })

  it('resolves a persistent CloudBase avatar reference before rendering it', async () => {
    const fileID = 'cloud://env.bucket/avatars/user-1.jpg'
    const freshUrl = 'https://cdn.example.com/avatars/user-1.jpg?token=fresh'
    h.createSignedUrl.mockResolvedValue({
      data: { signedUrl: freshUrl },
    })

    const wrapper = await mountSuspended(MemberAvatar, {
      props: { src: fileID, alt: 'User' },
    })
    await flushPromises()

    expect(h.createSignedUrl).toHaveBeenCalledWith(fileID, 7 * 24 * 60 * 60)
    expect(wrapper.get('img[role="img"]').attributes('src')).toBe(freshUrl)
  })

  it('refreshes a legacy signed CloudBase avatar URL', async () => {
    const bucket = 'yunlefun-8g7ybcxc7345c490-1250000000'
    const legacyUrl = `https://${bucket}.tcb.qcloud.la/avatars/user-2.jpg?sign=expired`
    const fileID = `cloud://yunlefun-8g7ybcxc7345c490.${bucket}/avatars/user-2.jpg`
    const freshUrl = 'https://cdn.example.com/avatars/user-2.jpg?token=fresh'
    h.createSignedUrl.mockResolvedValue({
      data: { signedUrl: freshUrl },
    })

    const wrapper = await mountSuspended(MemberAvatar, {
      props: { src: legacyUrl, alt: 'Legacy User' },
    })
    await flushPromises()

    expect(h.createSignedUrl).toHaveBeenCalledWith(fileID, 7 * 24 * 60 * 60)
    expect(wrapper.get('img[role="img"]').attributes('src')).toBe(freshUrl)
  })

  it('renders third-party avatar URLs without sending them to CloudBase', async () => {
    const url = 'https://avatars.githubusercontent.com/u/1?v=4'
    const wrapper = await mountSuspended(MemberAvatar, {
      props: { src: url, alt: 'GitHub User' },
    })
    await flushPromises()

    expect(h.createSignedUrl).not.toHaveBeenCalled()
    expect(wrapper.get('img[role="img"]').attributes('src')).toBe(url)
  })

  it('exposes an active membership marker to pointer and keyboard users', async () => {
    const wrapper = await mountSuspended(MemberAvatar, {
      props: { alt: 'Member', isMember: true },
      shallow: true,
    })

    const marker = wrapper.get('[aria-label="云乐坊会员"]')
    expect(marker.attributes('title')).toBe('云乐坊会员')
    expect(marker.attributes('role')).toBe('img')
    expect(marker.attributes('tabindex')).toBe('0')
  })
})
