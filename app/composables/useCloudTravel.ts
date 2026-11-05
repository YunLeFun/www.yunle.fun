import { getCloudJourneyPath } from '~/utils/cloud-journey'

export const CLOUD_TRAVEL_DURATION = 450

/** 给持续运行的风景一个轻微推进，不接管路由，也不等待动画。 */
export function useCloudTravel() {
  const traveling = shallowRef(false)
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  let timer: ReturnType<typeof setTimeout> | undefined

  function finish() {
    traveling.value = false
    clearTimeout(timer)
  }

  function onClick(event: MouseEvent) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || reducedMotion.value)
      return
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[data-cloud-link]') : null
    if (!link || (link.target && link.target !== '_self') || link.hasAttribute('download'))
      return
    const target = new URL(link.href, location.href)
    if (target.origin !== location.origin || getCloudJourneyPath(target.pathname) !== '/explore' || getCloudJourneyPath(location.pathname) !== '/')
      return
    finish()
    traveling.value = true
    timer = setTimeout(finish, CLOUD_TRAVEL_DURATION)
  }

  useEventListener(import.meta.client ? document : undefined, 'click', onClick, { capture: true })
  useEventListener(import.meta.client ? document : undefined, 'visibilitychange', () => {
    if (document.hidden)
      finish()
  })
  useEventListener('pagehide', finish)
  watch(reducedMotion, reduced => reduced && finish())
  const router = useRouter()
  const removeAfterEach = router.afterEach((_to, _from, failure) => {
    if (failure)
      finish()
  })
  const removeError = router.onError(finish)
  onBeforeUnmount(() => {
    finish()
    removeAfterEach()
    removeError()
  })
  return { traveling: readonly(traveling) }
}
