/**
 * 认证核心状态管理
 * 提供 user, loading, error 以及 fetchUser/checkAuthStatus/logout 等基础方法
 */
import type { TcbRawUser, User } from './types'
import { getErrorMessage, mapCloudbaseUser } from './types'
import { useServerSession } from './useServerSession'

const RE_USERNAME = /^[a-z][\w-]{2,19}$/i

export function useTcbAuthCore() {
  const { auth } = useCloudbase()
  const nuxtApp = useNuxtApp()
  const config = useRuntimeConfig()
  const router = useRouter()
  const toast = useToast()
  const { upsertMyProfile } = useUserProfile()
  // 双层会话编排（开关 cookieSession 开启时生效，见 docs/cookie-session-migration.md）
  const cookieSession = config.public.cookieSession as boolean
  const { setServerSession, bootstrapFromCookie, clearServerSession } = useServerSession()

  const user = useState<User | null>('auth_user', () => null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const isAuthenticated = computed(() => !!user.value)
  // 首次会话校验是否完成（跨组件共享）。用于区分「校验中」与「确实未登录」，
  // 让头像区在恢复登录态期间显示骨架占位，而非闪一下「登录 / 注册」按钮。
  const authReady = useState<boolean>('auth_ready', () => false)
  const authStatus = computed<'pending' | 'authenticated' | 'guest'>(() =>
    !authReady.value ? 'pending' : user.value ? 'authenticated' : 'guest',
  )
  // 新手机号用户首次登录时置位，由全局 OnboardingModal 接住弹一次引导（localStorage 按 uid 防重）
  const needsOnboarding = useState<boolean>('needs_onboarding', () => false)

  const clearAuth = () => {
    user.value = null
    error.value = null
  }

  /**
   * 异步补充密码设置状态。JS SDK getUser() 不返回密码状态，需查 HTTP API
   * /auth/v1/user/me。该字段仅「设置 - 安全」用得到，故与登录态恢复解耦，
   * 不阻塞头像 / 昵称等展示。仅当仍是同一登录用户时才回填，避免登出后被「复活」。
   */
  const enrichPasswordStatus = async (userId: string) => {
    const { data: sessionData } = await auth.getSession()
    const accessToken = sessionData?.session?.access_token
    if (!accessToken)
      return
    const envId = config.public.cloudbaseEnvId as string
    const res = await fetch(`https://${envId}.api.tcloudbasegateway.com/auth/v1/user/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok)
      return
    const profile = await res.json()
    // API 返回 password: "SET" | "UNSET" 等
    if (typeof profile.password === 'string' && user.value?.id === userId)
      user.value = { ...user.value, hasPassword: profile.password === 'SET' }
  }

  const fetchUser = async () => {
    try {
      loading.value = true
      error.value = null
      const { data, error: authError } = await auth.getUser()
      if (authError || !data?.user) {
        clearAuth()
        return null
      }
      const rawUser = data.user as unknown as TcbRawUser

      // 立即就绪：头像 / 昵称等展示字段无需等待网络，先填充登录态
      user.value = mapCloudbaseUser(rawUser)

      if (user.value) {
        // 手机 OTP 默认昵称＝完整手机号（PII 且不体面）。首次登录检测到裸手机号昵称，
        // 换成品牌默认名（如「云游者_k7m2」）并写回 CloudBase auth，从源头根治。
        // 幂等：写回后昵称不再是手机号，下次登录不再触发；写回失败则下次按同一 uid 生成同名，无害。
        if (looksLikePhone(user.value.nickname)) {
          const friendly = generateDefaultNickname(user.value.id)
          user.value = { ...user.value, nickname: friendly }
          auth.updateUser({ nickname: friendly })
            .catch(e => console.warn('[auth] 写回默认昵称失败:', e))
          needsOnboarding.value = true
        }
        // 同步公开资料到 user_profiles（供关注 / 粉丝等社交展示），fire-and-forget
        upsertMyProfile({
          login: user.value.login,
          nickname: user.value.nickname,
          avatar: user.value.avatar,
          description: user.value.description,
        }).catch(() => {})
        // 密码状态异步补充，不阻塞登录态恢复
        enrichPasswordStatus(user.value.id).catch(e => console.warn('[auth] 获取密码状态失败:', e))
        // 双层会话：登录成功后种 / 续 httpOnly cookie（fire-and-forget）
        if (cookieSession)
          setServerSession().catch(() => {})
      }
      return user.value
    }
    catch (err: unknown) {
      console.error('获取用户信息失败:', err)
      error.value = getErrorMessage(err)
      clearAuth()
      return null
    }
    finally {
      loading.value = false
      authReady.value = true
    }
  }

  const checkAuthStatus = async () => {
    // 折叠并发的重复校验：首屏中间件与 UserMenu 可能同时触发，复用同一次请求
    const inflight = nuxtApp._authCheckPromise as Promise<void> | undefined
    if (inflight)
      return inflight
    const run = (async () => {
      try {
        let data: Awaited<ReturnType<typeof auth.getSession>>['data'] | undefined
        // 双层会话：首轮检查优先用 httpOnly cookie 恢复，避免 SDK 在无 localStorage
        // 时先落入空/匿名会话，导致保护路由误判未登录并跳转登录页。
        if (cookieSession) {
          const restored = await bootstrapFromCookie()
          if (restored)
            data = (await auth.getSession()).data
        }
        if (!data?.session)
          data = (await auth.getSession()).data
        if (data?.session)
          await fetchUser()
      }
      catch {
        // CloudBase 未登录
      }
      finally {
        authReady.value = true
      }
    })()
    nuxtApp._authCheckPromise = run
    try {
      await run
    }
    finally {
      nuxtApp._authCheckPromise = null
    }
  }

  const logout = async () => {
    try {
      loading.value = true
      await auth.signOut()
      // 双层会话：清 httpOnly cookie（CloudBase signOut 已清内存/会话存储 token）
      if (cookieSession)
        await clearServerSession()
      clearAuth()
      toast.add({ title: '已退出登录', description: '期待您的再次光临', color: 'neutral' })
      await router.push('/login')
    }
    catch (err: unknown) {
      console.error('退出登录失败:', err)
      clearAuth()
      toast.add({ title: '退出失败', description: getErrorMessage(err), color: 'error' })
    }
    finally {
      loading.value = false
    }
  }

  const setUsername = async (username: string) => {
    try {
      loading.value = true
      error.value = null
      if (user.value?.login)
        throw new Error('用户名已设置，不可修改')
      if (!RE_USERNAME.test(username))
        throw new Error('用户名格式不正确：3-20 个字符，以字母开头，只允许字母、数字、下划线和连字符')

      const { error: updateError } = await auth.updateUser({ username })
      if (updateError) {
        const msg = updateError.message || '设置用户名失败'
        throw new Error(msg.includes('duplicate') || msg.includes('already') || msg.includes('exists')
          ? '该用户名已被占用，请换一个试试'
          : msg)
      }
      await fetchUser()
      toast.add({ title: '设置成功', description: `您的用户名已设置为 @${username}`, color: 'success' })
    }
    catch (err: unknown) {
      console.error('设置用户名失败:', err)
      error.value = getErrorMessage(err)
      toast.add({ title: '设置失败', description: getErrorMessage(err) || '请稍后重试', color: 'error' })
      throw err
    }
    finally {
      loading.value = false
    }
  }

  return {
    auth,
    router,
    toast,
    user,
    loading,
    error,
    isAuthenticated,
    authReady,
    authStatus,
    needsOnboarding,
    clearAuth,
    fetchUser,
    checkAuthStatus,
    logout,
    setUsername,
  }
}
