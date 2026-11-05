// @vitest-environment nuxt
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import AchievementCloud from '../../app/components/achievements/AchievementCloud.vue'
import CloudAchievementSky from '../../app/components/achievements/CloudAchievementSky.vue'
import SkyHero from '../../app/components/SkyHero.vue'

describe('profile cloud atmosphere', () => {
  it('applies the equipped cloud to the sky and foreground clouds, then restores the default on removal', async () => {
    const wrapper = await mountSuspended(SkyHero, { props: { cloudEffect: 'rainbow' }, shallow: true })
    expect(wrapper.attributes('data-cloud-effect')).toBe('rainbow')
    expect(wrapper.getComponent(CloudAchievementSky).props('effect')).toBe('rainbow')
    expect(wrapper.findAllComponents(AchievementCloud).map(cloud => cloud.props('effect'))).toEqual(['rainbow', 'rainbow'])
    await wrapper.setProps({ cloudEffect: 'sunset' })
    expect(wrapper.getComponent(CloudAchievementSky).props('effect')).toBe('sunset')
    await wrapper.setProps({ cloudEffect: null })
    expect(wrapper.attributes('data-cloud-effect')).toBeUndefined()
    expect(wrapper.findComponent(CloudAchievementSky).exists()).toBe(false)
    expect(wrapper.findAllComponents(AchievementCloud)).toHaveLength(0)
    wrapper.unmount()
  })
})
