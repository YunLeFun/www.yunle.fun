const SESSION_KEY = 'ylf:home-cloud-entrance:v1'
export const HOME_ENTRANCE_DURATION = 1500

/** 装饰性入场：只消费一次当前标签页会话，不参与页面或认证的加载流程。 */
export function useHomeEntrance() {
  const active = shallowRef(false)
  const consumed = useState('home-cloud-entrance-consumed', () => false)
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  let timer: ReturnType<typeof setTimeout> | undefined

  function finish() {
    active.value = false
    clearTimeout(timer)
    timer = undefined
  }

  function begin() {
    if (consumed.value)
      return
    consumed.value = true

    try {
      if (sessionStorage.getItem(SESSION_KEY))
        return
      // 开始时就记录，快速跳转或刷新也不会重播。
      sessionStorage.setItem(SESSION_KEY, '1')
    }
    catch {
      // 无法持久化会话标记时跳过，避免每次刷新都播放。
      return
    }

    // 慢速 hydration 时，用户可能已经滚动、跳到锚点或切换标签页。
    if (reducedMotion.value || document.hidden || window.scrollY > 32 || window.location.hash)
      return

    active.value = true
    timer = setTimeout(finish, HOME_ENTRANCE_DURATION + 100)
  }

  // 用户开始操作就让出画面，不阻止默认点击、键盘或滚动行为。
  useEventListener('pointerdown', finish, { passive: true })
  useEventListener('keydown', finish)
  useEventListener('scroll', finish, { passive: true })
  useEventListener('pagehide', finish)
  useEventListener(import.meta.client ? document : undefined, 'visibilitychange', () => {
    if (document.hidden)
      finish()
  })
  watch(reducedMotion, (reduced) => {
    if (reduced)
      finish()
  })
  onBeforeUnmount(finish)

  return { active: readonly(active), finish, begin }
}
