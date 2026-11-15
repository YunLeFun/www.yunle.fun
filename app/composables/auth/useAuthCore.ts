/**
 * 认证核心状态管理
 * 提供 user, loading, error 以及 fetchUser/checkAuthStatus/logout 等基础方法
 */
import type { TcbRawUser, User } from './types'
import { isAnonymousSession } from '@yunlefun/sso'
import { normalizeAvatarSource } from '~/utils/avatar'
import {
  generateTemporaryUsername,
  getUsernameUpdateErrorMessage,
  getUsernameValidationError,
  isTemporaryUsername,
  normalizeUsername,
} from '~/utils/username'
import { getErrorMessage, mapCloudbaseUser } from './types'
import { useAuthAcquisition } from './useAcquisition'
import { useServerSession } from './useServerSession'

export function useTcbAuthCore() {
  const { app, auth } = useCloudbase()
  const { resumeAfterSessionRecovery } = useAuthAcquisition(app, auth)
  const nuxtApp = useNuxtApp()
  const config = useRuntimeConfig()
  const router = useRouter()
  const toast = useAppToast()
  const { upsertMyProfile, syncRestricted } = useUserProfile()
  const { refresh: refreshAccountAccess, clear: clearAccountAccess } = useAccountAccess()
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
  // 认证代次（登出 / 清理时递增），用于阻止在途 fetchUser/setServerSession 晚归后复活已退出状态
  const authEpoch = useState<number>('auth_epoch', () => 0)
  // 新手机号用户首次登录时置位，由全局 OnboardingModal 接住弹一次引导（localStorage 按 uid 防重）
  const needsOnboarding = useState<boolean>('needs_onboarding', () => false)

  const clearAuth = () => {
    authEpoch.value += 1
    user.value = null
    error.value = null
    clearAccountAccess()
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
    const startEpoch = authEpoch.value
    try {
      loading.value = true
      error.value = null
      const { data, error: authError } = await auth.getUser()
      if (authEpoch.value !== startEpoch)
        return null
      if (authError || !data?.user) {
        clearAuth()
        return null
      }
      const rawUser = data.user as unknown as TcbRawUser
      if (isAnonymousSession({ user: rawUser })) {
        clearAuth()
        return null
      }

      const mapped = mapCloudbaseUser(rawUser)
      const nextUser = mapped
        ? {
            ...mapped,
            // 新资料保存 fileID；旧资料若保存了已过期的 CloudBase 临时 URL，
            // 则在登录恢复时还原为 fileID，随后由展示层实时换取可访问 URL。
            avatar: normalizeAvatarSource(mapped.avatar, String(config.public.cloudbaseEnvId || '')),
          }
        : null

      // 双层会话：在 user.value 就绪并触发登录页 watch(isAuthenticated) 跳转前，
      // 先完成 httpOnly cookie 封签（若 bootstrap 已成功封过同对令牌，内部会自动跳过，若失败则借此重试）。
      if (nextUser && cookieSession)
        await setServerSession().catch(() => false)

      if (authEpoch.value !== startEpoch)
        return null

      // 立即就绪：头像 / 昵称等展示字段无需等待后续资料同步，先填充登录态
      user.value = nextUser

      if (user.value) {
        const accountAccess = await refreshAccountAccess(user.value.id, true)
        if (authEpoch.value !== startEpoch)
          return null
        if (accountAccess.restricted)
          return user.value

        // OAuth / OTP 身份不一定自带符合站内规则的 username。为每个 uid 生成稳定的
        // 临时用户名写回 Auth，避免身份占位符阻塞公开资料同步；临时用户名可由用户替换一次。
        if (!user.value.login) {
          const temporaryUsername = generateTemporaryUsername(user.value.id)
          try {
            const { error: usernameError } = await auth.updateUser({ username: temporaryUsername })
            if (usernameError)
              throw usernameError
            if (authEpoch.value === startEpoch && user.value)
              user.value = { ...user.value, login: temporaryUsername }
          }
          catch (usernameError) {
            // 临时用户名写回失败不应阻塞登录或领取；公开资料允许 login 为空。
            console.warn('[auth] 写回临时用户名失败:', usernameError)
          }
        }
        if (authEpoch.value !== startEpoch || !user.value)
          return null

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
        // 登录完成前同步公开资料，降低用户随即进入领取页时资料仍未建立的窗口。
        const syncedProfile = await upsertMyProfile({
          login: user.value.login,
          nickname: user.value.nickname,
          avatar: user.value.avatar,
          description: user.value.description,
        })
        if (authEpoch.value !== startEpoch)
          return null
        if (!syncedProfile && !syncRestricted.value)
          console.warn('[auth] 公开资料同步未完成，将在下次登录重试')
        // 密码状态异步补充，不阻塞登录态恢复
        enrichPasswordStatus(user.value.id).catch(e => console.warn('[auth] 获取密码状态失败:', e))
      }
      return user.value
    }
    catch (err: unknown) {
      if (authEpoch.value !== startEpoch)
        return null
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
      const startEpoch = authEpoch.value
      try {
        // 双层会话：先查当前内存/本地 SDK 会话；仅当无有效非匿名会话时才用 httpOnly cookie 恢复，
        // 避免已有活跃会话时被旧 cookie 中的一次性 refresh_token 刷新覆盖或二次消费。
        let { data } = await auth.getSession()
        if (authEpoch.value !== startEpoch)
          return
        let restoredFromCookie = false
        if (cookieSession && (!data?.session || isAnonymousSession(data.session))) {
          restoredFromCookie = await bootstrapFromCookie()
          if (authEpoch.value !== startEpoch)
            return
          if (restoredFromCookie) {
            data = (await auth.getSession()).data
            if (authEpoch.value !== startEpoch)
              return
          }
        }
        if (data?.session && !isAnonymousSession(data.session)) {
          await fetchUser()
          if (authEpoch.value === startEpoch && user.value?.id)
            void resumeAfterSessionRecovery(user.value.id)
        }
        else if (authEpoch.value === startEpoch) {
          clearAuth()
        }
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
      authEpoch.value += 1
      loading.value = true
      await auth.signOut()
      clearAuth()
      // 双层会话：清 httpOnly cookie（若此时仍有封签请求在途，内部会等其落地后再清，防止旧 cookie 复活）
      if (cookieSession)
        await clearServerSession()
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
    const normalizedUsername = normalizeUsername(username)
    try {
      loading.value = true
      error.value = null
      const currentLogin = user.value?.login
      if (currentLogin && !isTemporaryUsername(currentLogin))
        throw new Error('用户名已设置，不可修改')
      const validationError = getUsernameValidationError(normalizedUsername)
      if (validationError)
        throw new Error(validationError)

      const { error: updateError } = await auth.updateUser({ username: normalizedUsername })
      if (updateError)
        throw updateError
      await fetchUser()
      toast.add({
        title: currentLogin ? '修改成功' : '设置成功',
        description: `您的用户名已设置为 @${normalizedUsername}`,
        color: 'success',
      })
    }
    catch (err: unknown) {
      console.error('设置用户名失败:', err)
      const message = getUsernameUpdateErrorMessage(err)
      error.value = message
      throw new Error(message)
    }
    finally {
      loading.value = false
    }
  }

  return {
    app,
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
