// 共享元素页面过渡：点开博客卡片时封面放大成文章头图、个人中心头像飞进设置页横幅、
// 抽屉里的明信片展开成目标页的页头。
//
// 只是渐进增强，平时的路由跳转完全不变：
// - 只有点击带 data-vt-link 的链接才会「预约」一次过渡，其余跳转不启动 View Transition；
// - 不支持 document.startViewTransition（Safari < 18 等）或系统要求减少动态效果时直接跳转；
// - view-transition-name 只在这一次过渡里挂到被点中的那个元素和它在新页面的落点上，结束即撤下。
//
// 标记约定（kind 只用小写字母与连字符，会拼进 view-transition-name）：
// - 链接：data-vt-link="blog-cover"，可空格分隔多个 kind；
// - 起点 / 落点：data-vt="blog-cover"。起点优先在被点的链接内部找，找不到再取当前页面第一个可见的；
//   落点取新页面第一个可见的。任一端缺席时该 kind 跳过，页面整体照常淡入淡出。

interface PendingTransition {
  kinds: string[]
  link: Element
  at: number
}

interface SharedPair {
  name: string
  source: HTMLElement
}

const ACTIVE_CLASS = 'ylf-vt-route'
// 点击到导航开始只隔几个微任务；超时说明这次点击没有真正跳转（例如点了当前页）。
const CLICK_WINDOW = 300
// 新页面迟迟不完成时不再冻结画面：直接放行，交给浏览器结束过渡。
const UPDATE_TIMEOUT = 1200
const CAPTURE_TIMEOUT = 500

function isVisible(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement))
    return false
  return typeof el.checkVisibility === 'function'
    ? el.checkVisibility()
    : el.getClientRects().length > 0
}

function findVisible(selector: string, scope: ParentNode, exclude?: Element) {
  for (const el of scope.querySelectorAll(selector)) {
    if (el !== exclude && isVisible(el))
      return el
  }
}

export default defineNuxtPlugin((nuxtApp) => {
  if (typeof document.startViewTransition !== 'function')
    return

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  const router = useRouter()
  const root = document.documentElement

  let pending: PendingTransition | undefined
  let finishUpdate: (() => void) | undefined

  // 捕获阶段先于 NuxtLink 自己的点击处理，保证路由守卫运行时已经知道这次点击。
  document.addEventListener('click', (event) => {
    pending = undefined
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return
    const link = event.target instanceof Element ? event.target.closest('[data-vt-link]') : null
    const kinds = link?.getAttribute('data-vt-link')?.split(/\s+/).filter(Boolean)
    if (link && kinds?.length)
      pending = { kinds, link, at: performance.now() }
  }, { capture: true })

  // 在导航一开始就截旧快照：此时被点的元素一定还在（抽屉会在点击后立刻收起，等到组件分块加载完就晚了）。
  // 守卫只等到快照截好，之后的分块加载、数据请求都在过渡的 update 回调里完成。
  router.beforeEach((to, from) => {
    const intent = pending
    pending = undefined
    // 守卫里的重定向（如 /docs → /docs/getting-started）会再走一遍 beforeEach，沿用进行中的过渡。
    if (finishUpdate || !intent || performance.now() - intent.at > CLICK_WINDOW || reducedMotion.matches)
      return
    if (to.matched.length === 0 || to.path === from.path)
      return

    const pairs: SharedPair[] = []
    for (const kind of intent.kinds) {
      const selector = `[data-vt~="${kind}"]`
      const source = intent.link.matches(selector) && isVisible(intent.link)
        ? intent.link
        : findVisible(selector, intent.link) ?? findVisible(selector, document)
      if (source) {
        const name = `ylf-vt-${kind}`
        source.style.viewTransitionName = name
        pairs.push({ name, source })
      }
    }
    if (!pairs.length)
      return

    let captured!: () => void
    const snapshotTaken = new Promise<void>(resolve => (captured = resolve))
    const updated = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, UPDATE_TIMEOUT)
      finishUpdate = () => {
        clearTimeout(timer)
        resolve()
      }
    })

    root.classList.add(ACTIVE_CLASS)
    let captureGuard: ReturnType<typeof setTimeout> | undefined
    const transition = document.startViewTransition(async () => {
      clearTimeout(captureGuard)
      captured()
      await updated
      finishUpdate = undefined
      // 旧快照已截好：撤下起点的名字，再把同名挂到新页面的落点上。
      const landed: HTMLElement[] = []
      for (const { name, source } of pairs) {
        source.style.viewTransitionName = ''
        const target = findVisible(`[data-vt~="${name.slice('ylf-vt-'.length)}"]`, document, source)
        if (target) {
          target.style.viewTransitionName = name
          // 落点不再播进场动画：它由过渡本身「飞」进来，进场的淡入会让它先消失再出现。
          target.setAttribute('data-vt-landed', '')
          landed.push(target)
        }
      }
      transition.finished.finally(() => {
        for (const el of landed)
          el.style.viewTransitionName = ''
      })
    })

    // 旧快照要等下一帧渲染才截取；页面不渲染（后台标签、主线程长时间阻塞）时不能让跳转卡住。
    captureGuard = setTimeout(() => {
      transition.skipTransition()
      captured()
    }, CAPTURE_TIMEOUT)

    transition.finished.catch(() => {}).finally(() => {
      root.classList.remove(ACTIVE_CLASS)
      for (const { source } of pairs)
        source.style.viewTransitionName = ''
    })

    return snapshotTaken
  })

  const release = () => finishUpdate?.()
  // 导航被取消或中止时不会有 page:finish，立即放行，让过渡在原页面上收尾。
  router.afterEach((_to, _from, failure) => {
    if (failure)
      release()
  })
  router.onError(release)
  nuxtApp.hook('page:finish', release)
  nuxtApp.hook('app:error', release)
  nuxtApp.hook('vue:error', release)
})
