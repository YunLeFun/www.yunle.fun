import type { MyProfileInput, UserProfile } from '~/types/social'

/**
 * 用户公开资料 composable。
 *
 * - 对接 account-api 的 `getProfile` / `upsertMyProfile`
 * - 资料是 CloudBase Auth 的去规范化缓存，用于关注 / 粉丝等需要展示「他人身份」的场景
 *   （Auth 资料前端只能取自己，故落一张公开资料表）
 */
export function useUserProfile() {
  const { app } = useCloudbase()

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
    if (!app)
      return null
    try {
      const res = await app.callFunction({
        name: 'account-api',
        data: { action: 'upsertMyProfile', profile },
      })
      return res.result as UserProfile
    }
    catch (err) {
      console.warn('[useUserProfile] upsertMyProfile failed:', err)
      return null
    }
  }

  return { getProfile, upsertMyProfile }
}
