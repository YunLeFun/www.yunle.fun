import type { FollowListResult, FollowRelation, FollowResult } from '~/types/social'

const EMPTY_RELATION: FollowRelation = { isFollowing: false, isFollowedBy: false }

/**
 * 关注 / 粉丝 composable。
 *
 * - 对接 account-api 的 `followUser` / `unfollowUser` / `getRelation`
 * - 单向关注（微博 / B 站式），跨站平台级（uid 维度，与云币 / 会员一致）
 */
export function useFollow() {
  const { app } = useCloudbase()
  const { user } = useTcbAuth()

  /** 读取我与某用户的关系（公开；未登录均为 false） */
  async function getRelation(targetId: string): Promise<FollowRelation> {
    if (!app || !targetId)
      return { ...EMPTY_RELATION }
    try {
      const res = await app.callFunction({
        name: 'account-api',
        data: { action: 'getRelation', targetId },
      })
      return (res.result as FollowRelation) ?? { ...EMPTY_RELATION }
    }
    catch (err) {
      console.warn('[useFollow] getRelation failed:', err)
      return { ...EMPTY_RELATION }
    }
  }

  /** 关注（需登录，幂等）。失败抛错。 */
  async function follow(targetId: string): Promise<FollowResult> {
    if (!user.value || !app)
      throw new Error('请先登录')
    const res = await app.callFunction({
      name: 'account-api',
      data: { action: 'followUser', targetId },
    })
    return res.result as FollowResult
  }

  /** 取关（需登录，幂等）。失败抛错。 */
  async function unfollow(targetId: string): Promise<FollowResult> {
    if (!user.value || !app)
      throw new Error('请先登录')
    const res = await app.callFunction({
      name: 'account-api',
      data: { action: 'unfollowUser', targetId },
    })
    return res.result as FollowResult
  }

  /** 关注 / 粉丝列表分页（公开；登录时列表项带 isFollowing），失败返回空 */
  async function listRelations(
    action: 'listFollowing' | 'listFollowers',
    userId: string,
    params: { skip?: number, limit?: number } = {},
  ): Promise<FollowListResult> {
    const empty: FollowListResult = { items: [], nextSkip: null }
    if (!app || !userId)
      return empty
    try {
      const res = await app.callFunction({
        name: 'account-api',
        data: { action, userId, skip: params.skip ?? 0, limit: params.limit ?? 20 },
      })
      return (res.result as FollowListResult) ?? empty
    }
    catch (err) {
      console.warn(`[useFollow] ${action} failed:`, err)
      return empty
    }
  }

  /** 某用户关注的人 */
  function listFollowing(userId: string, params?: { skip?: number, limit?: number }) {
    return listRelations('listFollowing', userId, params)
  }

  /** 某用户的粉丝 */
  function listFollowers(userId: string, params?: { skip?: number, limit?: number }) {
    return listRelations('listFollowers', userId, params)
  }

  return { getRelation, follow, unfollow, listFollowing, listFollowers }
}
