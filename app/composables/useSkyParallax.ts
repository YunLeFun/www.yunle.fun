import type { Ref } from 'vue'

/**
 * 为云景写入视差变量：`--px` / `--py` 是鼠标在区域内的位置（-1 到 1），
 * `--scroll` 是区域已滚出视口的像素数。各图层按自己的深度换算位移。
 *
 * 只响应鼠标，触屏不会因为手指按住而晃动；减少动态效果时保持静止。
 */
export function useSkyParallax(target: Ref<HTMLElement | null>) {
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  let frame = 0
  let pointer = { x: 0, y: 0 }

  function write() {
    frame = 0
    const el = target.value
    if (!el)
      return

    const box = el.getBoundingClientRect()
    const scroll = reducedMotion.value ? 0 : Math.min(Math.max(-box.top, 0), box.height)
    el.style.setProperty('--px', pointer.x.toFixed(3))
    el.style.setProperty('--py', pointer.y.toFixed(3))
    el.style.setProperty('--scroll', scroll.toFixed(1))
  }

  function schedule() {
    if (!frame)
      frame = requestAnimationFrame(write)
  }

  useEventListener(target, 'pointermove', (event: PointerEvent) => {
    const el = target.value
    if (!el || event.pointerType !== 'mouse' || reducedMotion.value)
      return

    const box = el.getBoundingClientRect()
    pointer = {
      x: ((event.clientX - box.left) / box.width) * 2 - 1,
      y: ((event.clientY - box.top) / box.height) * 2 - 1,
    }
    schedule()
  })

  useEventListener(target, 'pointerleave', () => {
    pointer = { x: 0, y: 0 }
    schedule()
  })

  useEventListener('scroll', () => {
    const el = target.value
    if (el && el.getBoundingClientRect().bottom > -64)
      schedule()
  }, { passive: true })

  onBeforeUnmount(() => cancelAnimationFrame(frame))
}
