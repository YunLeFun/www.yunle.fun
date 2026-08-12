/**
 * 全局认证中间件
 * 在每次路由切换时检查认证状态
 */
export default defineNuxtRouteMiddleware(async (to) => {
  // 仅在客户端运行
  if (import.meta.server)
    return

  const config = useRuntimeConfig()
  const currentUser = useState<{ id?: string } | null>('auth_user', () => null)
  const serverSession = config.public.cookieSession ? useUserSession() : null
  const hasRestorableSession = Boolean(currentUser.value?.id)
    || hasPersistedCloudbaseCredentials(config.public.cloudbaseEnvId)
    || Boolean(serverSession?.loggedIn.value)

  // 公开页面无需为明确的匿名访客初始化 CloudBase。已有本地 / cookie 会话时仍恢复
  // 完整认证态并执行账号限制检查；受保护页面则始终走原有认证门禁。
  if (!shouldRestoreAuthOnRoute(to.path, hasRestorableSession)) {
    useState<boolean>('auth_ready', () => false).value = true
    return
  }

  const { useTcbAuthSession } = await import('~/composables/auth/useAuthSession')
  const { checkAuthStatus, isAuthenticated, authReady } = useTcbAuthSession()

  // 首次访问时从持久化会话恢复登录态；authReady 完成后信任内存登录态，
  // 不再每次导航重复 getSession（checkAuthStatus 内部亦会折叠并发调用）
  if (!authReady.value)
    await checkAuthStatus()

  if (isAuthenticated.value) {
    const { useAccountAccess } = await import('~/composables/useAccountAccess')
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
