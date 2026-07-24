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

    expect(h.createSignedUrl).toHaveBeenCalledWith(fileID, 24 * 60 * 60)
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

    expect(h.createSignedUrl).toHaveBeenCalledWith(fileID, 24 * 60 * 60)
    expect(wrapper.get('img[role="img"]').attributes('src')).toBe(freshUrl)
  })

  it('refreshes a bare legacy CloudBase avatar URL before the browser requests it', async () => {
    const bucket = 'yunlefun-8g7ybcxc7345c490-1250000000'
    const legacyUrl = `https://${bucket}.tcb.qcloud.la/avatars/user-3.jpg`
    const fileID = `cloud://yunlefun-8g7ybcxc7345c490.${bucket}/avatars/user-3.jpg`
    const freshUrl = 'https://cdn.example.com/avatars/user-3.jpg?token=fresh'
    let resolveSignedUrl!: (value: { data: { signedUrl: string } }) => void
    h.createSignedUrl.mockReturnValue(new Promise((resolve) => {
      resolveSignedUrl = resolve
    }))

    const wrapper = await mountSuspended(MemberAvatar, {
      props: { src: legacyUrl, alt: 'Bare Legacy User' },
    })
    await flushPromises()

    expect(h.createSignedUrl).toHaveBeenCalledWith(fileID, 24 * 60 * 60)
    expect(wrapper.find('img[role="img"]').exists()).toBe(false)

    resolveSignedUrl({
      data: { signedUrl: freshUrl },
    })
    await flushPromises()

    expect(wrapper.get('img[role="img"]').attributes('src')).toBe(freshUrl)
  })

  it('falls back to text without requesting a legacy URL when signing fails', async () => {
    const bucket = 'yunlefun-8g7ybcxc7345c490-1250000000'
    const legacyUrl = `https://${bucket}.tcb.qcloud.la/avatars/user-4.jpg`
    h.createSignedUrl.mockRejectedValue(new Error('signing unavailable'))

    const wrapper = await mountSuspended(MemberAvatar, {
      props: { src: legacyUrl, alt: '风信子' },
    })
    await flushPromises()

    expect(h.createSignedUrl).toHaveBeenCalledTimes(1)
    expect(wrapper.find('img[role="img"]').exists()).toBe(false)
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

  it('uses one character when no avatar image is available', async () => {
    const wrapper = await mountSuspended(MemberAvatar, {
      props: { alt: '风信子' },
    })

    expect(wrapper.text()).toContain('风')
    expect(wrapper.text()).not.toContain('风信')
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
