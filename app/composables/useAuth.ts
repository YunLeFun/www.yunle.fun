/**
 * 认证 Composable
 * 处理用户登录、注册、OAuth 等认证相关功能
 */

export interface User {
  id: number
  login?: string | null
  email?: string | null
  phone?: string | null
  nickname?: string
  avatar?: string | null
  role: 'USER' | 'ADMIN'
  disabled?: string | null
  createdAt: string
  updatedAt: string
}

export interface LoginResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  user?: User
}

export interface AuthState {
  user: User | null
  accessToken: string | null
  refreshToken: string | null
  loading: boolean
  error: string | null
}

/**
 * 认证状态管理
 */
export function useAuth() {
  const config = useRuntimeConfig()
  const router = useRouter()
  const toast = useToast()

  // 持久化状态
  const user = useCookie<User | null>('user', {
    maxAge: 30 * 24 * 60 * 60, // 30 天
    sameSite: 'lax',
  })

  const accessToken = useCookie<string | null>('access_token', {
    maxAge: 2 * 60 * 60, // 2 小时
    sameSite: 'lax',
    secure: import.meta.env.MODE === 'production',
  })

  const refreshToken = useCookie<string | null>('refresh_token', {
    maxAge: 30 * 24 * 60 * 60, // 30 天
    sameSite: 'lax',
    secure: import.meta.env.MODE === 'production',
  })

  // 状态
  const loading = ref(false)
  const error = ref<string | null>(null)

  // 计算属性
  const isAuthenticated = computed(() => !!user.value && !!accessToken.value)

  /**
   * 清除认证信息
   */
  const clearAuth = () => {
    user.value = null
    accessToken.value = null
    refreshToken.value = null
    error.value = null
  }

  /**
   * API 基础请求函数
   */
  const apiRequest = async <T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> => {
    const url = `${config.public.apiBaseUrl}${endpoint}`

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    }

    // 添加认证 token
    if (accessToken.value) {
      headers.Authorization = `Bearer ${accessToken.value}`
    }

    const response = await fetch(url, {
      ...options,
      headers,
      credentials: 'include', // 重要：携带 Cookie
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(errorData.message || `HTTP error! status: ${response.status}`)
    }

    return response.json()
  }

  /**
   * 获取当前用户信息
   */
  const fetchUser = async () => {
    try {
      loading.value = true
      error.value = null

      const userData = await apiRequest<User>('/auth/profile')
      user.value = userData

      return userData
    }
    catch (err: any) {
      console.error('获取用户信息失败:', err)
      error.value = err.message
      // 如果获取失败，清除本地数据
      clearAuth()
      return null
    }
    finally {
      loading.value = false
    }
  }

  /**
   * 邮箱密码登录
   */
  const loginWithPassword = async (email: string, password: string) => {
    try {
      loading.value = true
      error.value = null

      const response = await apiRequest<LoginResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })

      // 保存 token 和用户信息
      accessToken.value = response.access_token
      refreshToken.value = response.refresh_token
      if (response.user) {
        user.value = response.user
      }

      toast.add({
        title: '登录成功',
        description: '欢迎回来！',
        color: 'success',
      })

      // 跳转到首页或之前的页面
      const redirect = router.currentRoute.value.query.redirect as string
      await router.push(redirect || '/')

      return response
    }
    catch (err: any) {
      console.error('登录失败:', err)
      error.value = err.message
      toast.add({
        title: '登录失败',
        description: err.message || '请检查邮箱和密码',
        color: 'error',
      })
      throw err
    }
    finally {
      loading.value = false
    }
  }

  /**
   * GitHub OAuth 登录
   */
  const loginWithGitHub = () => {
    loading.value = true

    // 构建 GitHub OAuth URL
    const apiBaseUrl = config.public.apiBaseUrl
    const githubAuthUrl = `${apiBaseUrl}/auth/github`

    // 保存当前路由，用于登录后跳转
    const currentRoute = router.currentRoute.value.fullPath
    if (currentRoute !== '/login') {
      localStorage.setItem('auth_redirect', currentRoute)
    }

    // 方式1: 直接跳转（推荐，因为后端使用 httpOnly Cookie）
    window.location.href = githubAuthUrl

    // 方式2: 弹窗登录（可选，需要修改后端 callback 使用 postMessage）
    // const popup = openOAuthPopup(githubAuthUrl)
    // if (popup) {
    //   // 监听弹窗关闭
    //   const timer = setInterval(() => {
    //     if (popup.closed) {
    //       clearInterval(timer)
    //       loading.value = false
    //       // 检查登录状态
    //       checkAuthStatus()
    //     }
    //   }, 500)
    // }
  }

  /**
   * 打开 OAuth 弹窗（可选）
   */
  // const openOAuthPopup = (url: string) => {
  //   const width = 600
  //   const height = 700
  //   const left = window.screenX + (window.outerWidth - width) / 2
  //   const top = window.screenY + (window.outerHeight - height) / 2

  //   return window.open(
  //     url,
  //     'OAuth Login',
  //     `width=${width},height=${height},left=${left},top=${top}`,
  //   )
  // }

  /**
   * 检查认证状态（在页面加载时调用）
   */
  const checkAuthStatus = async () => {
    if (accessToken.value) {
      // 如果有 token，尝试获取用户信息
      await fetchUser()
    }
  }

  /**
   * 刷新 Access Token
   */
  const refreshAccessToken = async () => {
    if (!refreshToken.value) {
      throw new Error('No refresh token available')
    }

    try {
      const response = await apiRequest<Omit<LoginResponse, 'user'>>('/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refresh_token: refreshToken.value }),
      })

      accessToken.value = response.access_token
      refreshToken.value = response.refresh_token

      return response
    }
    catch (err) {
      console.error('刷新 token 失败:', err)
      clearAuth()
      throw err
    }
  }

  /**
   * 退出登录
   */
  const logout = async () => {
    try {
      loading.value = true

      // 调用后端登出 API
      await apiRequest('/auth/logout', {
        method: 'POST',
      }).catch(() => {
        // 忽略错误，继续清除本地数据
      })

      clearAuth()

      toast.add({
        title: '已退出登录',
        description: '期待您的再次光临',
        color: 'neutral',
      })

      await router.push('/login')
    }
    catch (err: any) {
      console.error('退出登录失败:', err)
      toast.add({
        title: '退出失败',
        description: err.message,
        color: 'error',
      })
    }
    finally {
      loading.value = false
    }
  }

  return {
    // 状态
    user: readonly(user),
    accessToken: readonly(accessToken),
    loading: readonly(loading),
    error: readonly(error),
    isAuthenticated,

    // 方法
    loginWithPassword,
    loginWithGitHub,
    logout,
    fetchUser,
    checkAuthStatus,
    refreshAccessToken,
    clearAuth,
  }
}
