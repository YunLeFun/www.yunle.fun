/**
 * 应用投币 / 支持榜 composable。
 *
 * - 对接 account-api 的 `tip` / `getAppSupport` / `getTipLeaderboard`
 * - 投币：1 云币/次，每应用每日上限 2 次（服务端封顶 + 幂等）
 * - 投币成功后刷新全局云币余额（useCoin）
 */

export interface AppSupport {
  appId: string
  /** 累计收到的云币（热度） */
  totalCoins: number
  /** 支持者人数 */
  supporterCount: number
  tipCount: number
  /** 当前用户是否支持过 */
  tippedByMe: boolean
  /** 当前用户累计投入 */
  myCoins: number
}

export interface TipResult {
  balance: number
  tipped: number
  slot: number
  /** 今日对该应用还可投币次数 */
  remainingToday: number
  isNewSupporter: boolean
  deduped: boolean
}

export interface LeaderboardItem {
  appId: string
  totalCoins: number
  supporterCount: number
  tipCount: number
}

export function useAppTips() {
  const { app } = useCloudbase()
  const { user } = useTcbAuth()
  const coin = useCoin()

  /** 读取某应用支持详情（公开；登录时带「我是否支持过」） */
  async function getAppSupport(appId: string): Promise<AppSupport | null> {
    if (!app)
      return null
    try {
      const res = await app.callFunction({
        name: 'account-api',
        data: { action: 'getAppSupport', appId },
      })
      return res.result as AppSupport
    }
    catch (err) {
      console.warn('[useAppTips] getAppSupport failed:', err)
      return null
    }
  }

  /** 投币（需登录）。失败抛错（余额不足 / 已达上限 / 给自己投币等）。 */
  async function tip(appId: string): Promise<TipResult> {
    if (!user.value || !app)
      throw new Error('请先登录')
    const res = await app.callFunction({
      name: 'account-api',
      data: { action: 'tip', appId },
    })
    const result = res.result as TipResult
    await coin.refresh()
    return result
  }

  /** 应用支持榜（公开，按热度倒序） */
  async function getLeaderboard(limit = 20): Promise<LeaderboardItem[]> {
    if (!app)
      return []
    try {
      const res = await app.callFunction({
        name: 'account-api',
        data: { action: 'getTipLeaderboard', limit },
      })
      return (res.result as { items: LeaderboardItem[] }).items
    }
    catch (err) {
      console.warn('[useAppTips] getLeaderboard failed:', err)
      return []
    }
  }

  return { getAppSupport, tip, getLeaderboard }
}
