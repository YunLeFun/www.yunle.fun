import type { User } from './auth/types'
import type { MyProfileInput, UserProfile } from '~/types/social'
import { isTestAccountFeatureRestriction } from '~/utils/account-feature-restriction'

/**
 * 用户公开资料 composable。
 *
 * - 对接 account-api 的 `getProfile` / `upsertMyProfile`
 * - 资料是 CloudBase Auth 的去规范化缓存，用于关注 / 粉丝等需要展示「他人身份」的场景
 *   （Auth 资料前端只能取自己，故落一张公开资料表）
 */
export function useUserProfile() {
  const { app } = useCloudbase()
  // Read shared auth state directly: useTcbAuth itself depends on this composable.
  const user = useState<User | null>('auth_user', () => null)
  const restrictedFor = useState<string | null>('profile_sync_restricted_uid', () => null)
  const syncRestricted = computed(() => !!user.value?.id && restrictedFor.value === user.value.id)

  /** 公开读取用户资料（按 uid 或 login，二选一），不存在返回 null */
  async function getProfile(params: { userId?: string, login?: string }): Promise<UserProfile | null> {
    if (!app)
      return null
    try {
      const res = await app.callFunction({
        name: 'account-api',
        data: { action: 'getProfile', ...params },
      })
      return (res.result as UserProfile | null) ?? null
    }
    catch (err) {
      console.warn('[useUserProfile] getProfile failed:', err)
      return null
    }
  }

  /** 同步本人公开资料（需登录；计数字段由服务端忽略），失败返回 null 不抛错 */
  async function upsertMyProfile(profile: MyProfileInput): Promise<UserProfile | null> {
    if (!app || syncRestricted.value)
      return null
    const uid = user.value?.id
    try {
      const res = await app.callFunction({
        name: 'account-api',
        data: { action: 'upsertMyProfile', profile, restrictionResponse: 'v1' },
      })
      if (user.value?.id !== uid)
        return null
      if (isTestAccountFeatureRestriction(res.result)) {
        if (uid)
          restrictedFor.value = uid
        return null
      }
      const result = res.result as UserProfile
      if (!result || typeof result.userId !== 'string')
        throw new Error('公开资料同步响应无效')
      return result
    }
    catch (err) {
      console.warn('[useUserProfile] upsertMyProfile failed:', err)
      return null
    }
  }

  return { getProfile, upsertMyProfile, syncRestricted }
}
