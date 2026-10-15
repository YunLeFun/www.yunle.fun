// 切换明暗主题时的场景过渡，与 YunLeFun/design 的 vitepress-theme-yunlefun/appearance 保持一致：
// - 切到深色：夜幕从屏幕顶端带着柔和下缘垂落，白天的页面随之暗下来；
// - 切到浅色：晴空从点击处向外柔和铺开，新画面带一点刚放晴的明亮；
// - 不支持 CSS mask 时退回圆形扩散，不支持 View Transitions 时退回颜色淡入淡出；
// - 系统要求减少动态效果时直接切换。

const fadeClass = 'ylf-appearance-fade'
const revealClass = 'ylf-appearance-reveal'
const nightClass = 'ylf-appearance-night'
const dayClass = 'ylf-appearance-day'

interface ViewTransitionDocument {
  startViewTransition?: (update: () => Promise<void>) => { ready: Promise<void>, finished: Promise<void> }
}

let fadeTimer: ReturnType<typeof setTimeout> | undefined

export function useAppearanceTransition() {
  const colorMode = useColorMode()
  const isDark = computed(() => colorMode.value === 'dark')

  async function apply(dark: boolean) {
    colorMode.preference = dark ? 'dark' : 'light'
    // color-mode 在侦听器里更新 <html> 的 class，等它落地后再让 View Transition 截取新画面。
    await nextTick()
  }

  function origin(event?: MouseEvent) {
    const target = event?.currentTarget instanceof Element ? event.currentTarget.getBoundingClientRect() : null
    // 键盘触发（detail 为 0）没有指针坐标，从开关中心展开；都没有时从右上角开始。
    if (event && event.detail > 0)
      return { x: event.clientX, y: event.clientY }
    if (target)
      return { x: target.left + target.width / 2, y: target.top + target.height / 2 }
    return { x: window.innerWidth - 64, y: 32 }
  }

  function reveal(dark: boolean, event: MouseEvent | undefined, startViewTransition: NonNullable<ViewTransitionDocument['startViewTransition']>) {
    const root = document.documentElement
    const width = window.innerWidth
    const height = window.innerHeight
    const { x, y } = origin(event)
    const softMask = CSS.supports?.('mask-image', 'linear-gradient(#000, #000)')
    const sceneClass = softMask ? (dark ? nightClass : dayClass) : undefined

    // 过渡期间暂停毛玻璃：新视图是实时画面，模糊层会让每一帧都重新绘制。
    root.classList.add(revealClass)
    if (sceneClass)
      root.classList.add(sceneClass)

    const transition = startViewTransition(() => apply(dark))
    // fill: forwards 的动画会一直挂在 html 的 ::view-transition-* 上；不取消的话会叠到下一次切换，
    // 例如晴空展开留下的 maskSize 会盖住夜幕的遮罩尺寸，让夜色一下子铺满。
    const animations: Animation[] = []
    const animate = (keyframes: Keyframe[] | PropertyIndexedKeyframes, options: KeyframeAnimationOptions) => {
      animations.push(root.animate(keyframes, options))
    }

    // 用具体像素值驱动 WAAPI，并在快照就绪后立即开始；forwards 保持终态直到过渡结束。
    transition.ready.then(() => {
      const fill = 'forwards' as const
      const newView = '::view-transition-new(root)'
      const oldView = '::view-transition-old(root)'
      const reach = Math.hypot(Math.max(x, width - x), Math.max(y, height - y))

      if (!softMask) {
        animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${reach}px at ${x}px ${y}px)`] },
          { duration: 480, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill, pseudoElement: newView },
        )
        return
      }

      if (dark) {
        const curtain = height * 1.5
        const timing = { duration: 820, easing: 'cubic-bezier(0.55, 0, 0.2, 1)', fill }
        animate({ maskPosition: [`0px ${-curtain}px`, '0px 0px'] }, { ...timing, pseudoElement: newView })
        animate({ filter: ['none', 'brightness(0.72) saturate(0.85)'] }, { ...timing, pseudoElement: oldView })
        return
      }

      const size = (reach * 2) / 0.7
      const timing = { duration: 720, easing: 'cubic-bezier(0.2, 0, 0, 1)', fill }
      animate(
        {
          maskSize: ['0px 0px', `${size}px ${size}px`],
          maskPosition: [`${x}px ${y}px`, `${x - size / 2}px ${y - size / 2}px`],
        },
        { ...timing, pseudoElement: newView },
      )
      animate(
        { filter: ['brightness(1.15) saturate(1.1)', 'none'] },
        { ...timing, duration: 900, pseudoElement: newView },
      )
    }, () => {})

    transition.finished.finally(() => {
      for (const animation of animations)
        animation.cancel()
      root.classList.remove(revealClass)
      if (sceneClass)
        root.classList.remove(sceneClass)
    })
  }

  function setAppearance(dark: boolean, event?: MouseEvent) {
    if (isDark.value === dark)
      return

    if (!import.meta.client || !window.matchMedia('(prefers-reduced-motion: no-preference)').matches) {
      void apply(dark)
      return
    }

    const startViewTransition = (document as ViewTransitionDocument).startViewTransition?.bind(document)
    if (startViewTransition) {
      reveal(dark, event, startViewTransition)
      return
    }

    // 连点可立即反转当前主题；普通过渡保持页面控件可交互。
    clearTimeout(fadeTimer)
    document.documentElement.classList.add(fadeClass)
    void apply(dark)
    fadeTimer = setTimeout(() => document.documentElement.classList.remove(fadeClass), 450)
  }

  function toggleAppearance(event?: MouseEvent) {
    setAppearance(!isDark.value, event)
  }

  return { isDark, setAppearance, toggleAppearance }
}
