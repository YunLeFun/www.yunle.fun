import { useTcbAuthSession } from '~/composables/auth/useAuthSession'

/**
 * 「用户会话就绪」时运行 fn。
 *
 * user.value 存在即代表会话已就绪——双层会话下 CloudBase 会话由 bootstrap（cookie→setSession）建立后才会
 * 置 user，故以 user 为准能保证 fn 里的鉴权请求不会在 token 就绪前触发（避免 bootstrap 窗口内 403）。
 * - 已就绪：立即运行
 * - 未就绪（如 cookie→setSession 恢复窗口、memory-only 每次加载）：待 user 首次出现后运行一次
 *
 * 用于替换页面里「onMounted 直接发鉴权请求」的写法（那种写法假设挂载时已登录，cookie 恢复场景会失败）。
 */
export function onUserSession(fn: () => void) {
  // 服务端没有 CloudBase 浏览器会话；避免把 SSR 的空会话状态序列化为“已检查”。
  if (import.meta.server)
    return

  const { user, authReady, checkAuthStatus } = useTcbAuthSession()
  // 公开路由不经全局中间件恢复登录态：若会话尚未校验，主动触发一次（从 cookie→setSession 恢复）
  if (!authReady.value)
    checkAuthStatus()
  if (user.value) {
    fn()
    return
  }
  const stop = watch(() => user.value?.id, (id) => {
    if (id) {
      stop()
      fn()
    }
  })
}
