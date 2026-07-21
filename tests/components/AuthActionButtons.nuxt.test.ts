// @vitest-environment nuxt
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import AuthActionButtons from '../../app/components/AuthActionButtons.vue'

describe('auth action buttons', () => {
  it('gives mobile login and registration links accessible names', async () => {
    const wrapper = await mountSuspended(AuthActionButtons)

    const mobileLogin = wrapper.find('a[href="/login"][aria-label="登录"]')
    const mobileSignup = wrapper.find('a[href="/signup"][aria-label="注册"]')

    expect(mobileLogin.exists()).toBe(true)
    expect(mobileLogin.classes()).toContain('lg:hidden')
    expect(mobileSignup.exists()).toBe(true)
    expect(mobileSignup.classes()).toContain('lg:hidden')
  })
})
