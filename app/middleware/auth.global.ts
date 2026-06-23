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
  const { checkAuthStatus, isAuthenticated, authReady } = useTcbAuthSession()

  // 首次访问时从持久化会话恢复登录态；authReady 完成后信任内存登录态，
  // 不再每次导航重复 getSession（checkAuthStatus 内部亦会折叠并发调用）
  if (!authReady.value)
    await checkAuthStatus()

  if (!isAuthenticated.value) {
    return navigateTo({
      path: '/login',
      query: { redirect: to.fullPath },
    })
  }
})
