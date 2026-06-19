import type { FeedResult } from '~/types/social'

/**
 * 关注动态 Feed composable。
 *
 * 对接 account-api 的 `getFollowingFeed`：拉取「我关注的人」最近发布的公开应用。
 */
export function useFeed() {
  const { app } = useCloudbase()
  const { user } = useTcbAuth()

  /** 关注动态分页（需登录），失败返回空 */
  async function getFollowingFeed(params: { skip?: number, limit?: number } = {}): Promise<FeedResult> {
    const empty: FeedResult = { items: [], nextSkip: null }
    if (!user.value || !app)
      return empty
    try {
      const res = await app.callFunction({
        name: 'account-api',
        data: { action: 'getFollowingFeed', skip: params.skip ?? 0, limit: params.limit ?? 20 },
      })
      return (res.result as FeedResult) ?? empty
    }
    catch (err) {
      console.warn('[useFeed] getFollowingFeed failed:', err)
      return empty
    }
  }

  return { getFollowingFeed }
}
