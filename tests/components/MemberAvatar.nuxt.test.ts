// @vitest-environment nuxt
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import MemberAvatar from '../../app/components/MemberAvatar.vue'

const envId = 'yunlefun-8g7ybcxc7345c490'
const bucket = `7975-${envId}-1325586649`

describe('memberAvatar', () => {
  it('renders a persistent CloudBase avatar reference as a public URL', async () => {
    const fileID = `cloud://${envId}.${bucket}/avatars/user-1.jpg`
    const wrapper = await mountSuspended(MemberAvatar, {
      props: { src: fileID, alt: 'User' },
    })

    expect(wrapper.get('img[role="img"]').attributes('src')).toBe(
      `https://${bucket}.tcb.qcloud.la/avatars/user-1.jpg`,
    )
  })

  it('removes the signature from a legacy public CloudBase avatar URL', async () => {
    const legacyUrl = `https://${bucket}.tcb.qcloud.la/avatars/user-2.jpg?sign=expired&t=1#avatar`
    const wrapper = await mountSuspended(MemberAvatar, {
      props: { src: legacyUrl, alt: 'Legacy User' },
    })

    expect(wrapper.get('img[role="img"]').attributes('src')).toBe(
      `https://${bucket}.tcb.qcloud.la/avatars/user-2.jpg`,
    )
  })

  it('does not render an untrusted CloudBase file reference', async () => {
    const fileID = 'cloud://another-env.bucket/avatars/user-3.jpg'
    const wrapper = await mountSuspended(MemberAvatar, {
      props: { src: fileID, alt: '风信子' },
    })

    expect(wrapper.find('img[role="img"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('风')
  })

  it('renders third-party avatar URLs unchanged', async () => {
    const url = 'https://avatars.githubusercontent.com/u/1?v=4'
    const wrapper = await mountSuspended(MemberAvatar, {
      props: { src: url, alt: 'GitHub User' },
    })

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
