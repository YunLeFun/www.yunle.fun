/**
 * 认证 Composable
 * 完全基于 CloudBase Auth SDK 实现所有认证方式：
 * - 手机号 OTP 登录/注册
 * - 邮箱 OTP 登录
 * - GitHub OAuth 登录（via CloudBase signInWithOAuth）
 * - 微信开放平台 OAuth 登录（via CloudBase signInWithOAuth）
 */

import type {
  LinkIdentityReq,
  ResetPasswordForEmailRes,
  SignInWithOtpRes,
  SignUpRes,
  UpdateUserWithVerificationRes,
} from '@cloudbase/auth'

/** CloudBase Auth SDK 返回的原始用户类型（从 type.d.ts 中定义） */
interface TcbRawUser {
  id: string
  aud: string
  role: string[]
  email: string | null
  phone: string | null
  app_metadata: {
    provider: string | null
    providers: string[]
  }
  user_metadata: {
    name: string | null
    picture: string | null
    username: string | null
    nickName: string | null
    avatarUrl: string | null
    hasPassword: boolean | null
    [key: string]: unknown
  }
  identities: Array<{
    id: string
    name: string
    picture: string
  }> | null
  created_at: string
  updated_at: string
  [key: string]: unknown
}

export interface UserIdentity {
  id: string
  name: string
  picture: string
}

export interface User {
  id: string
  login?: string | null
  email?: string | null
  phone?: string | null
  nickname?: string
  avatar?: string | null
  role: string
  hasPassword: boolean
  providers: string[]
  identities: UserIdentity[]
  createdAt: string
  updatedAt: string
}

export interface AuthState {
  user: User | null
  loading: boolean
  error: string | null
}

/** OTP data 返回类型：包含 verifyOtp 回调 */
export type TcbOtpData = SignInWithOtpRes['data']
/** SignUp data 返回类型：包含 verifyOtp 回调 */
export type TcbSignUpData = SignUpRes['data']
/** UpdateUser 返回的 data 联合类型（可能包含 verifyOtp 或 user） */
export type TcbBindVerificationData = UpdateUserWithVerificationRes['data'] | { user?: unknown }
/** 重置密码返回的 data 类型 */
export type TcbResetPasswordData = ResetPasswordForEmailRes['data']

/**
 * 将 CloudBase User 转为本地 User 结构
 */
function mapCloudbaseUser(cbUser: TcbRawUser): User | null {
  if (!cbUser)
    return null
  const apiHasPassword = !!cbUser.user_metadata?.hasPassword
  // CloudBase API 在通过 resetPasswordForEmail 设置密码后可能不会更新 hasPassword，
  // 使用 localStorage 作为 fallback
  const localFlag = typeof localStorage !== 'undefined'
    && localStorage.getItem(`pwd_set_${cbUser.id}`) === '1'
  return {
    id: cbUser.id || '',
    login: cbUser.user_metadata?.username || null,
    email: cbUser.email || null,
    phone: cbUser.phone || null,
    nickname: cbUser.user_metadata?.nickName || cbUser.user_metadata?.name || cbUser.user_metadata?.username || undefined,
    avatar: cbUser.user_metadata?.avatarUrl || cbUser.user_metadata?.picture || null,
    role: cbUser.role?.[0] || 'USER',
    hasPassword: apiHasPassword || localFlag,
    providers: cbUser.app_metadata?.providers || [],
    identities: (cbUser.identities || []).map(i => ({ id: i.id, name: i.name, picture: i.picture })),
    createdAt: cbUser.created_at || '',
    updatedAt: cbUser.updated_at || '',
  }
}

/**
 * 将底层错误信息转换为用户友好的提示
 */
const ERROR_MESSAGE_MAP: Record<string, string> = {
  'Failed to fetch': '网络连接失败，请检查网络后重试',
  'NetworkError': '网络异常，请检查网络连接',
  'Load failed': '网络请求失败，请稍后重试',
  'The Internet connection appears to be offline': '网络已断开，请检查网络连接',
  'Network request failed': '网络请求失败，请稍后重试',
}

function getErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return ERROR_MESSAGE_MAP[raw] || raw
}

/**
 * 认证状态管理
 */
export function useTcbAuth() {
  const { auth } = useCloudbase()
  const router = useRouter()
  const toast = useToast()

  // 状态
  const user = useState<User | null>('auth_user', () => null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  // 计算属性
  const isAuthenticated = computed(() => !!user.value)

  /**
   * 清除认证信息
   */
  const clearAuth = () => {
    user.value = null
    error.value = null
  }

  /**
   * 从 CloudBase 获取当前用户信息并更新本地状态
   */
  const fetchUser = async () => {
    try {
      loading.value = true
      error.value = null

      const { data, error: authError } = await auth.getUser()

      if (authError || !data?.user) {
        clearAuth()
        return null
      }

      user.value = mapCloudbaseUser(data.user as unknown as TcbRawUser)
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

  /**
   * 发送手机验证码（登录）
   */
  const sendPhoneOtp = async (phone: string) => {
    try {
      loading.value = true
      error.value = null

      const { data, error: otpError } = await auth.signInWithOtp({ phone })

      if (otpError) {
        throw new Error(otpError.message || '发送验证码失败')
      }

      toast.add({
        title: '验证码已发送',
        description: '请查看手机短信',
        color: 'success',
      })

      return data
    }
    catch (err: unknown) {
      console.error('发送验证码失败:', err)
      error.value = getErrorMessage(err)
      toast.add({
        title: '发送失败',
        description: getErrorMessage(err) || '请稍后重试',
        color: 'error',
      })
      throw err
    }
    finally {
      loading.value = false
    }
  }

  /**
   * 验证手机验证码并完成登录
   */
  const verifyPhoneOtp = async (otpData: TcbOtpData, token: string) => {
    try {
      loading.value = true
      error.value = null

      if (!otpData.verifyOtp) {
        throw new Error('OTP 验证回调不可用')
      }
      const { data, error: verifyError } = await otpData.verifyOtp({ token })

      if (verifyError) {
        throw new Error(verifyError.message || '验证码验证失败')
      }

      await fetchUser()

      toast.add({
        title: '登录成功',
        description: '欢迎回来！',
        color: 'success',
      })

      const redirect = router.currentRoute.value.query.redirect as string
      await router.push(redirect || '/')

      return data
    }
    catch (err: unknown) {
      console.error('验证失败:', err)
      error.value = getErrorMessage(err)
      toast.add({
        title: '验证失败',
        description: getErrorMessage(err) || '验证码错误或已过期',
        color: 'error',
      })
      throw err
    }
    finally {
      loading.value = false
    }
  }

  /**
   * 手机号注册（发送验证码）
   */
  const signUpWithPhone = async (phone: string) => {
    try {
      loading.value = true
      error.value = null

      const { data, error: signUpError } = await auth.signUp({ phone } as Parameters<typeof auth.signUp>[0])

      if (signUpError) {
        throw new Error(signUpError.message || '注册失败')
      }

      toast.add({
        title: '验证码已发送',
        description: '请查看手机短信',
        color: 'success',
      })

      return data
    }
    catch (err: unknown) {
      console.error('注册失败:', err)
      error.value = getErrorMessage(err)
      toast.add({
        title: '注册失败',
        description: getErrorMessage(err) || '请稍后重试',
        color: 'error',
      })
      throw err
    }
    finally {
      loading.value = false
    }
  }

  /**
   * 验证注册验证码并完成注册
   */
  const verifySignUpOtp = async (signUpData: TcbSignUpData, token: string) => {
    try {
      loading.value = true
      error.value = null

      if (!signUpData.verifyOtp) {
        throw new Error('注册验证回调不可用')
      }
      const { data, error: verifyError } = await signUpData.verifyOtp({ token })

      if (verifyError) {
        throw new Error(verifyError.message || '验证码验证失败')
      }

      await fetchUser()

      toast.add({
        title: '注册成功',
        description: '欢迎加入！',
        color: 'success',
      })

      const redirect = router.currentRoute.value.query.redirect as string
      await router.push(redirect || '/')

      return data
    }
    catch (err: unknown) {
      console.error('注册验证失败:', err)
      error.value = getErrorMessage(err)
      toast.add({
        title: '验证失败',
        description: getErrorMessage(err) || '验证码错误或已过期',
        color: 'error',
      })
      throw err
    }
    finally {
      loading.value = false
    }
  }

  /**
   * 发送邮箱验证码（登录）
   */
  const sendEmailOtp = async (email: string) => {
    try {
      loading.value = true
      error.value = null

      const { data, error: otpError } = await auth.signInWithOtp({ email })

      if (otpError) {
        throw new Error(otpError.message || '发送验证码失败')
      }

      toast.add({
        title: '验证码已发送',
        description: '请查看您的邮箱',
        color: 'success',
      })

      return data
    }
    catch (err: unknown) {
      console.error('发送邮箱验证码失败:', err)
      error.value = getErrorMessage(err)
      toast.add({
        title: '发送失败',
        description: getErrorMessage(err) || '请稍后重试',
        color: 'error',
      })
      throw err
    }
    finally {
      loading.value = false
    }
  }

  /**
   * 验证邮箱验证码并完成登录
   */
  const verifyEmailOtp = async (otpData: TcbOtpData, token: string) => {
    try {
      loading.value = true
      error.value = null

      if (!otpData.verifyOtp) {
        throw new Error('OTP 验证回调不可用')
      }
      const { data, error: verifyError } = await otpData.verifyOtp({ token })

      if (verifyError) {
        throw new Error(verifyError.message || '验证码验证失败')
      }

      await fetchUser()

      toast.add({
        title: '登录成功',
        description: '欢迎回来！',
        color: 'success',
      })

      const redirect = router.currentRoute.value.query.redirect as string
      await router.push(redirect || '/')

      return data
    }
    catch (err: unknown) {
      console.error('邮箱验证失败:', err)
      error.value = getErrorMessage(err)
      toast.add({
        title: '验证失败',
        description: getErrorMessage(err) || '验证码错误或已过期',
        color: 'error',
      })
      throw err
    }
    finally {
      loading.value = false
    }
  }

  /**
   * 绑定邮箱（发送验证码到新邮箱）
   */
  const bindEmail = async (email: string) => {
    try {
      loading.value = true
      error.value = null

      const { data, error: updateError } = await auth.updateUser({ email })

      if (updateError) {
        throw new Error(updateError.message || '发送验证码失败')
      }

      toast.add({
        title: '验证码已发送',
        description: '请查看您的邮箱',
        color: 'success',
      })

      return data
    }
    catch (err: unknown) {
      console.error('绑定邮箱失败:', err)
      error.value = getErrorMessage(err)
      toast.add({
        title: '发送失败',
        description: getErrorMessage(err) || '请稍后重试',
        color: 'error',
      })
      throw err
    }
    finally {
      loading.value = false
    }
  }

  /**
   * 验证邮箱绑定验证码
   */
  const verifyBindEmail = async (bindData: TcbBindVerificationData, email: string, token: string) => {
    try {
      loading.value = true
      error.value = null

      if (!('verifyOtp' in bindData) || !bindData.verifyOtp) {
        throw new Error('绑定验证回调不可用')
      }
      const { data, error: verifyError } = await bindData.verifyOtp({ email, token })

      if (verifyError) {
        throw new Error(verifyError.message || '验证码验证失败')
      }

      await fetchUser()

      toast.add({
        title: '绑定成功',
        description: '邮箱已成功绑定',
        color: 'success',
      })

      return data
    }
    catch (err: unknown) {
      console.error('验证绑定邮箱失败:', err)
      error.value = getErrorMessage(err)
      toast.add({
        title: '验证失败',
        description: getErrorMessage(err) || '验证码错误或已过期',
        color: 'error',
      })
      throw err
    }
    finally {
      loading.value = false
    }
  }

  /**
   * 绑定第三方身份（GitHub / 微信开放平台）
   * 使用 CloudBase Auth SDK 的 linkIdentity 方法
   * 流程与 signInWithOAuth 类似，重定向到第三方授权页面
   * 授权完成后回调到 /auth/callback 页面处理绑定结果
   */
  const linkIdentity = async (provider: string) => {
    try {
      loading.value = true
      error.value = null

      // 标记为绑定模式，回调页面据此判断行为
      localStorage.setItem('auth_link_provider', provider)
      localStorage.setItem('auth_redirect', router.currentRoute.value.fullPath)

      const { data, error: linkError } = await auth.linkIdentity({ provider } as LinkIdentityReq)

      if (linkError) {
        throw new Error(linkError.message || '绑定失败')
      }

      // linkIdentity 返回的 data 中可能包含重定向 URL
      if (data?.provider) {
        // SDK 会自动触发重定向
        return data
      }
    }
    catch (err: unknown) {
      console.error(`绑定第三方身份失败 (${provider}):`, err)
      loading.value = false
      error.value = getErrorMessage(err)
      localStorage.removeItem('auth_link_provider')
      toast.add({
        title: '绑定失败',
        description: getErrorMessage(err) || '请稍后重试',
        color: 'error',
      })
      throw err
    }
  }

  /**
   * 绑定 GitHub 账号
   */
  const bindGitHub = () => linkIdentity('github')

  /**
   * 绑定微信账号
   */
  const bindWeChat = () => linkIdentity('wx_open')

  /**
   * 获取已绑定的第三方身份列表
   */
  const getUserIdentities = async () => {
    try {
      const { data, error: identityError } = await auth.getUserIdentities()
      if (identityError) {
        throw new Error(identityError.message || '获取绑定信息失败')
      }
      return data.identities || []
    }
    catch (err: unknown) {
      console.error('获取绑定身份失败:', err)
      return []
    }
  }

  /**
   * 解绑第三方身份
   */
  const unbindIdentity = async (provider: string) => {
    try {
      loading.value = true
      error.value = null

      const { error: unlinkError } = await auth.unlinkIdentity({ provider })

      if (unlinkError) {
        throw new Error(unlinkError.message || '解绑失败')
      }

      await fetchUser()

      toast.add({
        title: '解绑成功',
        description: '已成功解除绑定',
        color: 'success',
      })
    }
    catch (err: unknown) {
      console.error(`解绑第三方身份失败 (${provider}):`, err)
      error.value = getErrorMessage(err)
      toast.add({
        title: '解绑失败',
        description: getErrorMessage(err) || '请稍后重试',
        color: 'error',
      })
      throw err
    }
    finally {
      loading.value = false
    }
  }

  /**
   * OAuth 登录（GitHub / 微信开放平台）
   *
   * CloudBase Auth SDK 内置 OAuth 流程：
   * 1. 调用 signInWithOAuth({ provider }) 获取授权 URL
   * 2. 重定向到第三方授权页面
   * 3. 授权完成后自动回调到 CloudBase 静态域名的 /__auth/ 路径
   * 4. CloudBase SDK 的 detectSessionInUrl: true 会自动处理回调并完成登录
   * 5. 页面刷新后通过 getSession/getUser 即可获取用户信息
   *
   * 前提条件：
   * - 在 CloudBase 控制台已配置 GitHub/微信 OAuth Provider
   * - GitHub OAuth App 的 callback URL 设置为:
   *   https://{staticDomain}/__auth/
   * - useCloudbase() 初始化时已设置 auth: { detectSessionInUrl: true }
   */
  const loginWithOAuth = async (provider: 'github' | 'wx_open') => {
    try {
      loading.value = true
      error.value = null

      // 保存当前路由用于登录后跳转
      const currentRoute = router.currentRoute.value.fullPath
      if (currentRoute !== '/login') {
        localStorage.setItem('auth_redirect', currentRoute)
      }

      const { data, error: oauthError } = await auth.signInWithOAuth({ provider })

      if (oauthError) {
        throw new Error(oauthError.message || 'OAuth 登录失败')
      }

      // 重定向到第三方授权页面
      if (data?.url) {
        window.location.href = data.url
      }
      else {
        throw new Error('未获取到授权地址')
      }
    }
    catch (err: unknown) {
      console.error(`OAuth 登录失败 (${provider}):`, err)
      loading.value = false
      error.value = getErrorMessage(err)
      toast.add({
        title: '登录失败',
        description: getErrorMessage(err) || '请稍后重试',
        color: 'error',
      })
      throw err
    }
  }

  /**
   * GitHub OAuth 登录
   */
  const loginWithGitHub = () => loginWithOAuth('github')

  /**
   * 微信开放平台 OAuth 登录（扫码登录）
   */
  const loginWithWeChat = () => loginWithOAuth('wx_open')

  /**
   * 检查认证状态（纯 CloudBase Auth）
   */
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

  /**
   * 退出登录
   */
  const logout = async () => {
    try {
      loading.value = true

      await auth.signOut()

      clearAuth()

      toast.add({
        title: '已退出登录',
        description: '期待您的再次光临',
        color: 'neutral',
      })

      await router.push('/login')
    }
    catch (err: unknown) {
      console.error('退出登录失败:', err)
      clearAuth()
      toast.add({
        title: '退出失败',
        description: getErrorMessage(err),
        color: 'error',
      })
    }
    finally {
      loading.value = false
    }
  }

  /**
   * 设置用户名（仅允许设置一次，不可修改）
   * 用户名规则：3-20 字符，只允许字母、数字、下划线和连字符，必须以字母开头
   */
  const setUsername = async (username: string) => {
    try {
      loading.value = true
      error.value = null

      // 前端校验：已设置过用户名则禁止修改
      if (user.value?.login) {
        throw new Error('用户名已设置，不可修改')
      }

      // 格式校验
      if (!/^[a-z][\w-]{2,19}$/i.test(username)) {
        throw new Error('用户名格式不正确：3-20 个字符，以字母开头，只允许字母、数字、下划线和连字符')
      }

      const { error: updateError } = await auth.updateUser({ username })

      if (updateError) {
        // CloudBase 会返回唯一性冲突错误
        const msg = updateError.message || '设置用户名失败'
        throw new Error(msg.includes('duplicate') || msg.includes('already') || msg.includes('exists')
          ? '该用户名已被占用，请换一个试试'
          : msg)
      }

      await fetchUser()

      toast.add({
        title: '设置成功',
        description: `您的用户名已设置为 @${username}`,
        color: 'success',
      })
    }
    catch (err: unknown) {
      console.error('设置用户名失败:', err)
      error.value = getErrorMessage(err)
      toast.add({
        title: '设置失败',
        description: getErrorMessage(err) || '请稍后重试',
        color: 'error',
      })
      throw err
    }
    finally {
      loading.value = false
    }
  }

  /**
   * 使用邮箱/手机号 + 密码登录
   */
  const signInWithPassword = async (params: { email?: string, phone?: string, username?: string, password: string }) => {
    try {
      loading.value = true
      error.value = null

      const { data, error: signInError } = await auth.signInWithPassword(params)

      if (signInError) {
        throw new Error(signInError.message || '密码登录失败')
      }

      await fetchUser()

      toast.add({
        title: '登录成功',
        description: '欢迎回来！',
        color: 'success',
      })

      const redirect = router.currentRoute.value.query.redirect as string
      await router.push(redirect || '/')

      return data
    }
    catch (err: unknown) {
      console.error('密码登录失败:', err)
      error.value = getErrorMessage(err)
      toast.add({
        title: '登录失败',
        description: getErrorMessage(err) || '用户名/邮箱/手机号或密码错误',
        color: 'error',
      })
      throw err
    }
    finally {
      loading.value = false
    }
  }

  /**
   * 首次设置密码 - 步骤1：发送验证码
   * 向用户已绑定的邮箱或手机号发送验证码以验证身份
   * 返回用于 resetPasswordForEmail 回调的 data
   */
  const requestSetPasswordOtp = async () => {
    try {
      loading.value = true
      error.value = null

      // 优先使用邮箱，其次手机号
      const target = user.value?.email || user.value?.phone
      if (!target) {
        throw new Error('请先绑定邮箱或手机号，再设置密码')
      }

      const { data, error: resetError } = await auth.resetPasswordForEmail(target)

      if (resetError) {
        throw new Error(resetError.message || '发送验证码失败')
      }

      toast.add({
        title: '验证码已发送',
        description: `请查看${user.value?.email ? '邮箱' : '手机短信'}`,
        color: 'success',
      })

      return data
    }
    catch (err: unknown) {
      console.error('发送验证码失败:', err)
      error.value = getErrorMessage(err)
      toast.add({
        title: '发送失败',
        description: getErrorMessage(err) || '请稍后重试',
        color: 'error',
      })
      throw err
    }
    finally {
      loading.value = false
    }
  }

  /**
   * 首次设置密码 - 步骤2：验证并设置密码
   * 使用 resetPasswordForEmail 返回的 updateUser 回调
   */
  const confirmSetPassword = async (resetData: TcbResetPasswordData, nonce: string, newPassword: string) => {
    try {
      loading.value = true
      error.value = null

      if (!resetData.updateUser) {
        throw new Error('设置密码回调不可用')
      }

      const { error: updateError } = await resetData.updateUser({ nonce, password: newPassword })

      if (updateError) {
        throw new Error(updateError.message || '设置密码失败')
      }

      // 持久化密码已设置标记（API 可能不会更新 hasPassword 字段）
      if (user.value?.id) {
        localStorage.setItem(`pwd_set_${user.value.id}`, '1')
      }

      await fetchUser()

      // 兜底：直接在本地修正
      if (user.value && !user.value.hasPassword) {
        user.value = { ...user.value, hasPassword: true }
      }

      toast.add({
        title: '设置成功',
        description: '密码已成功设置',
        color: 'success',
      })
    }
    catch (err: unknown) {
      console.error('设置密码失败:', err)
      error.value = getErrorMessage(err)
      toast.add({
        title: '设置失败',
        description: getErrorMessage(err) || '请稍后重试',
        color: 'error',
      })
      throw err
    }
    finally {
      loading.value = false
    }
  }

  /**
   * 修改密码（已有密码的用户）
   * 通过 resetPasswordForOld 直接修改
   */
  const changePassword = async (oldPassword: string, newPassword: string) => {
    try {
      loading.value = true
      error.value = null

      const { error: resetError } = await auth.resetPasswordForOld({
        old_password: oldPassword,
        new_password: newPassword,
      })
      if (resetError) {
        throw new Error(resetError.message || '修改密码失败')
      }

      await fetchUser()

      toast.add({
        title: '修改成功',
        description: '密码已成功修改',
        color: 'success',
      })
    }
    catch (err: unknown) {
      console.error('修改密码失败:', err)
      error.value = getErrorMessage(err)
      toast.add({
        title: '操作失败',
        description: getErrorMessage(err) || '请检查密码是否正确',
        color: 'error',
      })
      throw err
    }
    finally {
      loading.value = false
    }
  }

  /**
   * 发送密码重置邮件/短信
   * @param emailOrPhone 邮箱或手机号
   */
  const resetPassword = async (emailOrPhone: string) => {
    try {
      loading.value = true
      error.value = null

      const { data, error: resetError } = await auth.resetPasswordForEmail(emailOrPhone)

      if (resetError) {
        throw new Error(resetError.message || '发送重置链接失败')
      }

      toast.add({
        title: '验证码已发送',
        description: '请查看您的邮箱或手机短信',
        color: 'success',
      })

      return data
    }
    catch (err: unknown) {
      console.error('发送重置密码失败:', err)
      error.value = getErrorMessage(err)
      toast.add({
        title: '发送失败',
        description: getErrorMessage(err) || '请稍后重试',
        color: 'error',
      })
      throw err
    }
    finally {
      loading.value = false
    }
  }

  /**
   * 使用重置密码回调设置新密码
   */
  const confirmResetPassword = async (resetData: TcbResetPasswordData, nonce: string, newPassword: string) => {
    try {
      loading.value = true
      error.value = null

      if (!resetData.updateUser) {
        throw new Error('重置密码回调不可用')
      }

      const { data, error: updateError } = await resetData.updateUser({ nonce, password: newPassword })

      if (updateError) {
        throw new Error(updateError.message || '重置密码失败')
      }

      await fetchUser()

      toast.add({
        title: '重置成功',
        description: '密码已成功重置，请使用新密码登录',
        color: 'success',
      })

      return data
    }
    catch (err: unknown) {
      console.error('重置密码失败:', err)
      error.value = getErrorMessage(err)
      toast.add({
        title: '重置失败',
        description: getErrorMessage(err) || '请稍后重试',
        color: 'error',
      })
      throw err
    }
    finally {
      loading.value = false
    }
  }

  return {
    // 状态
    user: readonly(user),
    loading: readonly(loading),
    error: readonly(error),
    isAuthenticated,

    // CloudBase Auth 方法
    sendPhoneOtp,
    verifyPhoneOtp,
    signUpWithPhone,
    verifySignUpOtp,
    sendEmailOtp,
    verifyEmailOtp,
    bindEmail,
    verifyBindEmail,

    // 密码认证
    signInWithPassword,
    changePassword,
    requestSetPasswordOtp,
    confirmSetPassword,
    resetPassword,
    confirmResetPassword,

    // 第三方身份绑定/解绑
    bindGitHub,
    bindWeChat,
    getUserIdentities,
    unbindIdentity,

    // OAuth 方法（全部通过 CloudBase Auth SDK）
    loginWithGitHub,
    loginWithWeChat,
    loginWithOAuth,

    // 用户名
    setUsername,

    // 通用方法
    logout,
    fetchUser,
    checkAuthStatus,
    clearAuth,
  }
}
