// @vitest-environment nuxt
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import AppButton from '../../app/components/AppButton.vue'
import { Button } from '../../app/components/ui/button'

function click(element: Element, type = 'click') {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true })
  element.dispatchEvent(event)
  return event
}

describe('button disabled and loading interactions', () => {
  it('blocks activation of disabled slotted links and restores it when enabled', async () => {
    const onClick = vi.fn()
    const wrapper = await mountSuspended(Button, {
      props: { asChild: true, disabled: true },
      attrs: { onClick },
      slots: { default: '<a href="#details">详情</a>' },
    })
    const link = wrapper.get('a')

    expect(click(link.element).defaultPrevented).toBe(true)
    expect(click(link.element, 'auxclick').defaultPrevented).toBe(true)
    expect(onClick).not.toHaveBeenCalled()
    expect(link.attributes('aria-disabled')).toBe('true')
    expect(link.attributes('tabindex')).toBe('-1')
    expect(link.attributes('disabled')).toBeUndefined()

    await wrapper.setProps({ disabled: false })
    expect(click(link.element).defaultPrevented).toBe(false)
    expect(onClick).toHaveBeenCalledOnce()
    expect(link.attributes('tabindex')).toBeUndefined()
  })

  it('removes the destination while an external link is loading', async () => {
    const wrapper = await mountSuspended(AppButton, {
      props: { href: 'https://yunle.fun', loading: true, label: '访问' },
    })
    const link = wrapper.get('a')
    expect(link.attributes('href')).toBeUndefined()
    expect(link.attributes('aria-busy')).toBe('true')
    expect(link.attributes('aria-disabled')).toBe('true')
    expect(click(link.element).defaultPrevented).toBe(true)

    await wrapper.setProps({ loading: false })
    expect(link.attributes('href')).toBe('https://yunle.fun')
    expect(link.attributes('aria-busy')).toBeUndefined()
  })

  it('removes disabled router destinations without losing the link label', async () => {
    const wrapper = await mountSuspended(AppButton, {
      props: { to: '/apps', disabled: true, label: '发现应用' },
    })
    expect(wrapper.get('a').attributes('href')).toBeUndefined()
    expect(wrapper.text()).toBe('发现应用')
    await wrapper.setProps({ disabled: false })
    expect(wrapper.get('a').attributes('href')).toBe('/apps')
  })

  it('retains native submit semantics while loading', async () => {
    const wrapper = await mountSuspended(AppButton, {
      props: { type: 'submit', loading: true, label: '保存' },
    })
    const button = wrapper.get('button')
    expect(button.attributes('type')).toBe('submit')
    expect((button.element as HTMLButtonElement).disabled).toBe(true)
    expect(button.attributes('aria-busy')).toBe('true')
    await wrapper.setProps({ loading: false })
    expect((button.element as HTMLButtonElement).disabled).toBe(false)
  })
})
