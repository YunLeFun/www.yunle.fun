import type { Directive } from 'vue'

const observers = new WeakMap<Element, IntersectionObserver>()

/**
 * 区块进入视口时轻轻浮起：`v-reveal` 或 `v-reveal="120"`（延迟毫秒）。
 *
 * 内容默认可见：服务端渲染、脚本未执行、首屏已可见或系统要求减少动态效果时都不会隐藏。
 * 只有挂载时仍在视口下方的元素才进入待揭示状态。
 */
export const vReveal: Directive<HTMLElement, number | undefined> = {
  mounted(el, binding) {
    if (typeof IntersectionObserver === 'undefined' || matchMedia('(prefers-reduced-motion: reduce)').matches)
      return
    if (el.getBoundingClientRect().top < window.innerHeight * 0.9)
      return

    el.style.setProperty('--reveal-delay', `${binding.value ?? 0}ms`)
    el.classList.add('ylf-reveal')

    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting)
        return
      el.classList.add('ylf-reveal--in')
      observer.disconnect()
      observers.delete(el)
    }, { rootMargin: '0px 0px -12% 0px' })

    observer.observe(el)
    observers.set(el, observer)
  },
  unmounted(el) {
    observers.get(el)?.disconnect()
    observers.delete(el)
  },
}
