/**
 * 全局认证中间件
 * 在每次路由切换时检查认证状态
 */

// 标记是否已完成首次认证检查，避免重复请求
let _authChecked = false

export default defineNuxtRouteMiddleware(async (to) => {
  // 仅在客户端运行
  if (import.meta.server)
    return

  const { checkAuthStatus, isAuthenticated } = useTcbAuth()

  // 首次访问时恢复登录态（无论是否公开路由）
  if (!_authChecked) {
    _authChecked = true
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
  ]

  // 检查是否是公开路由（包括子路由）
  const isPublicRoute = publicRoutes.some(route =>
    to.path === route || to.path.startsWith(`${route}/`),
  )

  // 如果不是公开路由，确保已认证
  if (!isPublicRoute) {
    // 非首次访问受保护路由时也检查一次
    if (!isAuthenticated.value) {
      await checkAuthStatus()
    }

    if (!isAuthenticated.value) {
      // 保存当前路由，登录后跳转回来
      return navigateTo({
        path: '/login',
        query: { redirect: to.fullPath },
      })
    }
  }
})
