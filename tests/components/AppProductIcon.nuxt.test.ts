// @vitest-environment nuxt
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import AppProductIcon from '../../app/components/apps/AppProductIcon.vue'
import { appIcons } from '../../app/config/app-icons'

const driveApp = {
  appId: 'drive',
  logoUrl: 'https://drive.yunle.fun/drive-app-icon.svg',
  fallbackMark: '盘',
}

describe('application product icon', () => {
  it('follows the current Drive app icon and retains full-canvas spacing when falling back', async () => {
    const wrapper = await mountSuspended(AppProductIcon, { props: { app: driveApp } })

    expect(wrapper.get('img').attributes('src')).toBe(driveApp.logoUrl)
    expect(wrapper.classes()).not.toContain('app-product-icon--mark')

    await wrapper.get('img').trigger('error')
    expect(wrapper.get('img').attributes('src')).toBe(appIcons.drive)
    expect(wrapper.classes()).not.toContain('app-product-icon--mark')

    await wrapper.get('img').trigger('error')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toBe(driveApp.fallbackMark)
  })

  it('retries the authoritative source when the registry logo changes', async () => {
    const wrapper = await mountSuspended(AppProductIcon, { props: { app: driveApp } })
    await wrapper.get('img').trigger('error')
    await wrapper.get('img').trigger('error')

    const updatedApp = { ...driveApp, logoUrl: `${driveApp.logoUrl}?v=next` }
    await wrapper.setProps({ app: updatedApp })

    expect(wrapper.get('img').attributes('src')).toBe(updatedApp.logoUrl)
    expect(wrapper.classes()).not.toContain('app-product-icon--mark')
  })

  it('retains the canonical full app icon for other applications', async () => {
    const wrapper = await mountSuspended(AppProductIcon, {
      props: { app: { appId: 'cms', logoUrl: 'https://cms.yunle.fun/logo.svg', fallbackMark: 'CMS' } },
    })

    expect(wrapper.get('img').attributes('src')).toBe(appIcons.cms)
    expect(wrapper.classes()).not.toContain('app-product-icon--mark')
  })
})
