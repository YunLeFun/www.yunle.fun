/**
 * 全局认证中间件
 * 在每次路由切换时检查认证状态
 */
export default defineNuxtRouteMiddleware(async (to) => {
  // 仅在客户端运行
  if (import.meta.server)
    return

  const { checkAuthStatus, isAuthenticated } = useTcbAuth()

  // 使用 useState 确保 SSR 安全，避免模块级变量跨请求污染
  const authChecked = useState('auth_checked', () => false)

  // 首次访问时恢复登录态（无论是否公开路由）
  if (!authChecked.value) {
    authChecked.value = true
    await checkAuthStatus()
  }

  // 公开路由（不需要登录）
  const publicRoutes = [
    '/',
    '/login',
    '/signup',
    '/auth/github',
    '/auth/callback',
    '/docs',
    '/pricing',
    '/blog',
    '/changelog',
    '/apps',
    '/developer',
  ]

  // 检查是否是公开路由（包括子路由）
  const isPublicRoute = publicRoutes.some(route =>
    to.path === route || to.path.startsWith(`${route}/`),
  )

  // 如果不是公开路由，确保已认证
  if (!isPublicRoute) {
    if (!isAuthenticated.value) {
      await checkAuthStatus()
    }

    if (!isAuthenticated.value) {
      return navigateTo({
        path: '/login',
        query: { redirect: to.fullPath },
      })
    }
  }
})
