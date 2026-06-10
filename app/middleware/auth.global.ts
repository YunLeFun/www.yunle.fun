/**
 * 全局认证中间件
 * 在每次路由切换时检查认证状态
 */
export default defineNuxtRouteMiddleware(async (to) => {
  // 仅在客户端运行
  if (import.meta.server)
    return

  if (isPublicAuthRoute(to.path))
    return

  const { useTcbAuthSession } = await import('~/composables/auth/useAuthSession')
  const { checkAuthStatus, isAuthenticated } = useTcbAuthSession()

  // 使用 useState 确保 SSR 安全，避免模块级变量跨请求污染
  const authChecked = useState('auth_checked', () => false)

  // 首次访问时恢复登录态（无论是否公开路由）
  if (!authChecked.value) {
    authChecked.value = true
    await checkAuthStatus()
  }

  if (!isAuthenticated.value) {
    await checkAuthStatus()
  }

  if (!isAuthenticated.value) {
    return navigateTo({
      path: '/login',
      query: { redirect: to.fullPath },
    })
  }
})
