import { useTcbAuthSession } from '~/composables/auth/useAuthSession'

/**
 * 客户端登录守卫（双层会话安全）。
 *
 * 仅在「会话检查完成（authReady）且确实未登录」时才跳转登录——避免 cookie→setSession 恢复窗口内
 * isAuthenticated 暂为 false 就把已登录用户误踢去登录页。公开路由不经全局中间件的登录态恢复，
 * 这类「自守卫的公开页」（如 /apps 管理页）尤其需要本门控，否则用户在新标签/清存储时会被弹登录。
 *
 * @param redirect 登录后回跳地址，默认当前完整路径
 */
export function useRequireAuth(redirect?: string) {
  // SSR 只输出无用户数据的页面加载壳；登录态必须在浏览器内从 CloudBase / cookie 会话恢复。
  if (import.meta.server)
    return

  const { isAuthenticated, authReady, checkAuthStatus } = useTcbAuthSession()
  const router = useRouter()
  const route = useRoute()
  // 公开路由不经全局中间件恢复登录态：若会话尚未校验，主动触发一次（从 cookie→setSession 恢复），
  // 否则 authReady 永不就绪、已登录用户也会被下面的守卫误判为未登录。
  if (!authReady.value)
    checkAuthStatus()
  watchEffect(() => {
    if (authReady.value && !isAuthenticated.value)
      router.push(`/login?redirect=${encodeURIComponent(redirect ?? route.fullPath)}`)
  })
}
