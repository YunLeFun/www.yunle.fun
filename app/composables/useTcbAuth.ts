/**
 * 认证 Composable - 统一入口
 *
 * 整合所有认证模块，保持对外 API 兼容：
 * - auth/useAuthCore: 核心状态管理（user, loading, fetchUser, logout, checkAuthStatus）
 * - auth/useOtp: 手机号 OTP 登录/注册与已绑定邮箱 OTP 登录
 * - auth/useOAuth: GitHub/微信 OAuth 登录、绑定/解绑
 * - auth/usePassword: 密码登录、修改、重置、邮箱/手机号绑定
 */
import { useTcbAuthCore } from './auth/useAuthCore'
import { useTcbOAuth } from './auth/useOAuth'
import { useTcbOtp } from './auth/useOtp'
import { useTcbPassword } from './auth/usePassword'

// 重新导出类型，保持原有导入路径兼容
export type {
  AuthState,
  TcbBindVerificationData,
  TcbOtpData,
  TcbResetPasswordData,
  TcbSignUpData,
  User,
  UserIdentity,
} from './auth/types'

export function useTcbAuth() {
  const core = useTcbAuthCore()
  const otp = useTcbOtp(core)
  const oauth = useTcbOAuth(core)
  const password = useTcbPassword(core)

  return {
    // 核心状态
    user: readonly(core.user),
    loading: readonly(core.loading),
    error: readonly(core.error),
    isAuthenticated: core.isAuthenticated,
    // 新用户首次引导（OnboardingModal 消费）
    needsOnboarding: core.needsOnboarding,

    // OTP
    ...otp,

    // 密码 & 邮箱/手机号绑定
    ...password,

    // OAuth & 第三方身份
    ...oauth,

    // 用户名
    setUsername: core.setUsername,

    // 通用
    logout: core.logout,
    fetchUser: core.fetchUser,
    checkAuthStatus: core.checkAuthStatus,
    clearAuth: core.clearAuth,
  }
}
