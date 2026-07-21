// @vitest-environment nuxt
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MemberAvatar from '../../app/components/MemberAvatar.vue'

const h = vi.hoisted(() => ({
  getTempFileURL: vi.fn(),
}))

mockNuxtImport('useCloudbase', () => () => ({
  app: { getTempFileURL: h.getTempFileURL },
}))

describe('memberAvatar', () => {
  beforeEach(() => {
    h.getTempFileURL.mockReset()
  })

  it('resolves a persistent CloudBase avatar reference before rendering it', async () => {
    const fileID = 'cloud://env.bucket/avatars/user-1.jpg'
    const freshUrl = 'https://cdn.example.com/avatars/user-1.jpg?token=fresh'
    h.getTempFileURL.mockResolvedValue({
      fileList: [{ fileID, tempFileURL: freshUrl }],
    })

    const wrapper = await mountSuspended(MemberAvatar, {
      props: { src: fileID, alt: 'User' },
      global: {
        stubs: {
          UAvatar: {
            props: ['src', 'alt', 'size'],
            template: '<img data-testid="avatar" :data-src="src" :alt="alt">',
          },
        },
      },
    })
    await flushPromises()

    expect(h.getTempFileURL).toHaveBeenCalledWith({ fileList: [fileID] })
    expect(wrapper.get('[data-testid="avatar"]').attributes('data-src')).toBe(freshUrl)
  })

  it('refreshes a legacy signed CloudBase avatar URL', async () => {
    const bucket = 'yunlefun-8g7ybcxc7345c490-1250000000'
    const legacyUrl = `https://${bucket}.tcb.qcloud.la/avatars/user-2.jpg?sign=expired`
    const fileID = `cloud://yunlefun-8g7ybcxc7345c490.${bucket}/avatars/user-2.jpg`
    const freshUrl = 'https://cdn.example.com/avatars/user-2.jpg?token=fresh'
    h.getTempFileURL.mockResolvedValue({
      fileList: [{ fileID, tempFileURL: freshUrl }],
    })

    const wrapper = await mountSuspended(MemberAvatar, {
      props: { src: legacyUrl, alt: 'Legacy User' },
      global: {
        stubs: {
          UAvatar: {
            props: ['src', 'alt', 'size'],
            template: '<img data-testid="avatar" :data-src="src" :alt="alt">',
          },
        },
      },
    })
    await flushPromises()

    expect(h.getTempFileURL).toHaveBeenCalledWith({ fileList: [fileID] })
    expect(wrapper.get('[data-testid="avatar"]').attributes('data-src')).toBe(freshUrl)
  })

  it('renders third-party avatar URLs without sending them to CloudBase', async () => {
    const url = 'https://avatars.githubusercontent.com/u/1?v=4'
    const wrapper = await mountSuspended(MemberAvatar, {
      props: { src: url, alt: 'GitHub User' },
      global: {
        stubs: {
          UAvatar: {
            props: ['src', 'alt', 'size'],
            template: '<img data-testid="avatar" :data-src="src" :alt="alt">',
          },
        },
      },
    })
    await flushPromises()

    expect(h.getTempFileURL).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="avatar"]').attributes('data-src')).toBe(url)
  })
})
