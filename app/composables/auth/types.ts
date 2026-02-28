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
    accessToken?: string
  }> | null
  created_at: string
  updated_at: string
  [key: string]: unknown
}

export interface UserIdentity {
  id: string
  name: string
  picture: string
  accessToken?: string
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
  const apiHasPassword = !!cbUser.user_metadata?.hasPassword
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

/** 错误信息映射 */
const ERROR_MESSAGE_MAP: Record<string, string> = {
  'Failed to fetch': '网络连接失败，请检查网络后重试',
  'NetworkError': '网络异常，请检查网络连接',
  'Load failed': '网络请求失败，请稍后重试',
  'The Internet connection appears to be offline': '网络已断开，请检查网络连接',
  'Network request failed': '网络请求失败，请稍后重试',
}

export function getErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return ERROR_MESSAGE_MAP[raw] || raw
}
