/**
 * 全局认证中间件
 * 在每次路由切换时检查认证状态
 */
export default defineNuxtRouteMiddleware(async (to) => {
  // 仅在客户端运行
  if (import.meta.server)
    return

  const { checkAuthStatus, isAuthenticated } = useAuth()

  // 公开路由（不需要登录）
  const publicRoutes = [
    '/',
    '/login',
    '/signup',
    '/forgot-password',
    '/auth/github-callback',
    '/docs',
    '/pricing',
    '/blog',
    '/changelog',
  ]

  // 检查是否是公开路由（包括子路由）
  const isPublicRoute = publicRoutes.some(route =>
    to.path === route || to.path.startsWith(`${route}/`),
  )

  // 如果不是公开路由，检查认证状态
  if (!isPublicRoute) {
    await checkAuthStatus()

    if (!isAuthenticated.value) {
      // 保存当前路由，登录后跳转回来
      return navigateTo({
        path: '/login',
        query: { redirect: to.fullPath },
      })
    }
  }
})
