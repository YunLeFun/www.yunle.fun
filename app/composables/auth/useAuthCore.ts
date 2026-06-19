/**
 * 认证核心状态管理
 * 提供 user, loading, error 以及 fetchUser/checkAuthStatus/logout 等基础方法
 */
import type { TcbRawUser, User } from './types'
import { getErrorMessage, mapCloudbaseUser } from './types'

const RE_USERNAME = /^[a-z][\w-]{2,19}$/i

export function useTcbAuthCore() {
  const { auth } = useCloudbase()
  const router = useRouter()
  const toast = useToast()
  const { upsertMyProfile } = useUserProfile()

  const user = useState<User | null>('auth_user', () => null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const isAuthenticated = computed(() => !!user.value)

  const clearAuth = () => {
    user.value = null
    error.value = null
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

      // JS SDK getUser() 不返回密码状态，需通过 HTTP API /auth/v1/user/me 补充
      try {
        const { data: sessionData } = await auth.getSession()
        const accessToken = sessionData?.session?.access_token
        if (accessToken) {
          const config = useRuntimeConfig()
          const envId = config.public.cloudbaseEnvId as string
          const res = await fetch(`https://${envId}.api.tcloudbasegateway.com/auth/v1/user/me`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          })
          if (res.ok) {
            const profile = await res.json()
            // API 返回 password: "SET" | "UNSET" 等
            if (typeof profile.password === 'string') {
              ;(rawUser as Record<string, unknown>)._passwordStatus = profile.password
            }
          }
        }
      }
      catch (e) {
        console.warn('[auth] 获取密码状态失败:', e)
      }

      user.value = mapCloudbaseUser(rawUser)
      // 同步公开资料到 user_profiles（供关注 / 粉丝等社交展示），fire-and-forget，不阻塞登录态
      if (user.value) {
        upsertMyProfile({
          login: user.value.login,
          nickname: user.value.nickname,
          avatar: user.value.avatar,
          description: user.value.description,
        }).catch(() => {})
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
    }
  }

  const checkAuthStatus = async () => {
    try {
      const { data } = await auth.getSession()
      if (data?.session) {
        await fetchUser()
      }
    }
    catch {
      // CloudBase 未登录
    }
  }

  const logout = async () => {
    try {
      loading.value = true
      await auth.signOut()
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
    clearAuth,
    fetchUser,
    checkAuthStatus,
    logout,
    setUsername,
  }
}
