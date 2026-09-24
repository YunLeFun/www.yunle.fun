// @vitest-environment nuxt
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import AppBadge from '../../app/components/AppBadge.vue'
import AppButton from '../../app/components/AppButton.vue'
import AppPageCard from '../../app/components/AppPageCard.vue'
import AppSelect from '../../app/components/AppSelect.vue'
import AppSeparator from '../../app/components/AppSeparator.vue'
import AppSwitch from '../../app/components/AppSwitch.vue'

describe('app components using YunLeFun Design colors', () => {
  it('keeps NuxtLink behavior when an accent button uses a shared tone', async () => {
    const wrapper = await mountSuspended(AppButton, {
      props: { to: '/apps', tone: 'coral', variant: 'outline' },
      slots: { default: '发现应用' },
    })

    const link = wrapper.get('a[href="/apps"]')
    expect(link.attributes('data-ylf-tone')).toBe('coral')
    expect(link.attributes('data-ylf-appearance')).toBe('outline')
    expect(link.text()).toBe('发现应用')
  })

  it('keeps status semantics independent of the requested accent tone', async () => {
    const button = await mountSuspended(AppButton, {
      props: { color: 'warning', tone: 'pink', variant: 'soft' },
      slots: { default: '稍后重试' },
    })
    const badge = await mountSuspended(AppBadge, {
      props: { color: 'success', variant: 'subtle' },
      slots: { default: '已完成' },
    })

    expect(button.get('[data-slot="button"]').attributes()).toMatchObject({
      'data-ylf-status': 'warning',
      'data-ylf-appearance': 'soft',
    })
    expect(button.get('[data-slot="button"]').attributes('data-ylf-tone')).toBeUndefined()
    expect(badge.get('[data-slot="badge"]').attributes()).toMatchObject({
      'data-ylf-status': 'success',
      'data-ylf-appearance': 'soft',
    })
  })

  it('forwards accent surfaces through existing card and separator wrappers', async () => {
    const card = await mountSuspended(AppPageCard, {
      props: { variant: 'tinted', tone: 'cyan' },
      slots: { default: '共享色彩' },
    })
    const separator = await mountSuspended(AppSeparator, {
      props: { variant: 'accent', tone: 'sun' },
    })

    expect(card.get('[data-slot="card"]').attributes()).toMatchObject({
      'data-ylf-tone': 'cyan',
      'data-ylf-variant': 'tinted',
    })
    expect(separator.get('[data-slot="separator"]').attributes()).toMatchObject({
      'data-ylf-tone': 'sun',
      'data-ylf-variant': 'accent',
    })
  })

  it('keeps form controls usable with shared color cues', async () => {
    const select = await mountSuspended(AppSelect, {
      props: {
        items: [{ label: '珊瑚橙', value: 'coral', color: 'var(--ylf-accent-coral)' }],
        modelValue: 'coral',
      },
    })
    const toggle = await mountSuspended(AppSwitch, {
      props: { tone: 'green', modelValue: true },
    })

    expect(select.get('[data-slot="select-trigger"] .ylf-select-swatch').attributes('style')).toContain('var(--ylf-accent-coral)')
    expect(select.get('[data-slot="select-trigger"]').text()).toContain('珊瑚橙')
    expect(toggle.get('[data-slot="switch"]').attributes('data-ylf-tone')).toBe('green')
  })
})
