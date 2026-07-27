/**
 * CloudBase Auth 类型定义和工具函数
 */
import type {
  LinkIdentityReq,
  ResetPasswordForEmailRes,
  SignInWithOtpRes,
  SignUpRes,
  UpdateUserWithVerificationRes,
} from '@cloudbase/auth'
import { isOAuthUsernamePlaceholder } from '../../utils/username'

/** CloudBase Auth SDK 返回的原始用户类型 */
export interface TcbRawUser {
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

export type UserGender = 'MALE' | 'FEMALE' | ''

export interface User {
  id: string
  login?: string | null
  email?: string | null
  phone?: string | null
  nickname?: string
  avatar?: string | null
  description?: string
  gender?: UserGender
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

/** OTP data 返回类型 */
export type TcbOtpData = SignInWithOtpRes['data']
export type TcbSignUpData = SignUpRes['data']
export type TcbBindVerificationData = UpdateUserWithVerificationRes['data'] | { user?: unknown }
export type TcbResetPasswordData = ResetPasswordForEmailRes['data']
export type { LinkIdentityReq }

/**
 * 将 CloudBase User 转为本地 User 结构
 */
export function mapCloudbaseUser(cbUser: TcbRawUser): User | null {
  if (!cbUser)
    return null
  // 通过 HTTP API /auth/v1/user/me 返回的 password 字段判断（"SET" 表示已设置）
  const passwordStatus = (cbUser as Record<string, unknown>)._passwordStatus as string | undefined
  const providers = cbUser.app_metadata?.providers || []
  const rawLogin = cbUser.user_metadata?.username?.trim() || null
  // OAuth provider 元数据偶尔不完整；占位判断只依赖不会成为合法用户名的纯数字格式。
  const login = isOAuthUsernamePlaceholder(rawLogin) ? null : rawLogin

  return {
    id: cbUser.id || '',
    login,
    email: cbUser.email || null,
    phone: cbUser.phone || null,
    nickname: cbUser.user_metadata?.nickName || cbUser.user_metadata?.name || login || undefined,
    avatar: cbUser.user_metadata?.avatarUrl || cbUser.user_metadata?.picture || null,
    description: (cbUser.user_metadata?.description as string) || '',
    gender: (['MALE', 'FEMALE'].includes(cbUser.user_metadata?.gender as string) ? cbUser.user_metadata.gender : '') as UserGender,
    role: cbUser.role?.[0] || 'USER',
    hasPassword: passwordStatus === 'SET',
    providers,
    // 仅保留展示所需字段；CloudBase 不会持久回传第三方 OAuth access token，
    // 故不要在此依赖 token 判断“是否绑定”——绑定状态以 providers / getUserIdentities() 为准。
    identities: (cbUser.identities || []).map(i => ({ id: i.id, name: i.name, picture: i.picture })),
    createdAt: cbUser.created_at || '',
    updatedAt: cbUser.updated_at || '',
  }
}

/** 错误信息映射 */
const ERROR_MESSAGE_MAP: Record<string, string> = {
  'Failed to fetch': '网络连接失败，请检查网络后重试',
  'NetworkError': '网络异常，请检查网络连接',
  'Load failed': '网络请求失败，请稍后重试',
  'The Internet connection appears to be offline': '网络已断开，请检查网络连接',
  'Network request failed': '网络请求失败，请稍后重试',
}

export function getErrorMessage(err: unknown): string {
  let raw: string
  if (err instanceof Error) {
    raw = err.message
  }
  else if (err && typeof err === 'object') {
    // CloudBase SDK 部分接口（如 grantProviderToken）失败时抛出
    // { error, error_description } 形式的普通对象而非 Error 实例
    const e = err as Record<string, unknown>
    raw = String(e.error_description || e.message || e.msg || e.error || err)
  }
  else {
    raw = String(err)
  }
  return ERROR_MESSAGE_MAP[raw] || raw
}

export interface AuthErrorPresentation {
  title: string
  description: string
  code: string | null
}

function getErrorCode(err: unknown, message: string): string | null {
  if (err && typeof err === 'object') {
    const source = err as Record<string, unknown>
    const code = source.code || source.error
    if (typeof code === 'string' && code)
      return code
  }
  if (/user_blocked|该用户被停用|用户被停用|账号.*停用/i.test(message))
    return 'user_blocked'
  return null
}

/** 登录入口统一使用的安全错误提示，不向用户暴露风控规则或内部异常。 */
export function getAuthErrorPresentation(err: unknown): AuthErrorPresentation {
  const message = getErrorMessage(err)
  const code = getErrorCode(err, message)
  if (code === 'user_blocked') {
    return {
      title: '账号已暂停登录',
      description: '该账号当前已被封禁，无法继续登录。若你曾申请注销，系统可能正在完成账号清理；如有疑问，请联系客服。',
      code,
    }
  }
  if (code === 'account_deletion_pending') {
    return {
      title: '账号正在注销冷静期',
      description: '请前往账号状态页，在截止时间前明确恢复账号后继续使用。',
      code,
    }
  }
  if (code === 'account_deletion_finalizing') {
    return {
      title: '账号正在完成注销',
      description: '注销已超过可恢复截止时间，系统正在完成账号清理。',
      code,
    }
  }
  if (code === 'account_banned') {
    return {
      title: '账号已被封禁',
      description: '请查看账号状态页了解公开原因、期限和申诉方式。',
      code,
    }
  }
  return {
    title: '登录失败',
    description: message,
    code,
  }
}
