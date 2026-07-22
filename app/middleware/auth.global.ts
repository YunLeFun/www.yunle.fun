/**
 * 全局认证中间件
 * 在每次路由切换时检查认证状态
 */
export default defineNuxtRouteMiddleware(async (to) => {
  // 仅在客户端运行
  if (import.meta.server)
    return

  const { useTcbAuthSession } = await import('~/composables/auth/useAuthSession')
  const { checkAuthStatus, isAuthenticated, authReady } = useTcbAuthSession()

  // 首次访问时从持久化会话恢复登录态；authReady 完成后信任内存登录态，
  // 不再每次导航重复 getSession（checkAuthStatus 内部亦会折叠并发调用）
  if (!authReady.value)
    await checkAuthStatus()

  if (isAuthenticated.value) {
    const { access, refresh } = useAccountAccess()
    const { user } = useTcbAuthSession()
    // 状态页必须绕过短缓存，避免用户刚提交注销后仍被旧 active 状态送回首页。
    await refresh(user.value?.id, to.path === '/account-status')
    if (access.value.restricted && to.path !== '/account-status')
      return navigateTo('/account-status')
    if (!access.value.restricted && to.path === '/account-status')
      return navigateTo('/')
  }

  if (isPublicAuthRoute(to.path))
    return

  if (!isAuthenticated.value) {
    return navigateTo({
      path: '/login',
      query: { redirect: to.fullPath },
    })
  }
})
