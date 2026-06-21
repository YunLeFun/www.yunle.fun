/**
 * 每日签到 composable。
 *
 * - 对接 account-api 的 `signIn` / `getSignInStatus`
 * - 免费 1 / 会员 2 云币，按东八区每日一次（服务端幂等）
 * - 签到成功后刷新全局云币余额（useCoin）
 */

export interface SignInStatus {
  signedToday: boolean
  /** 今日（应）得云币数 */
  reward: number
  /** 东八区日期 key（YYYY-MM-DD） */
  dateKey: string
  isMember: boolean
  /** 当前连续签到天数 */
  currentStreak: number
  /** 历史最长连续天数 */
  longestStreak: number
  /** 本周期内进度（1..weekLen；0=尚未开始 / 已断签） */
  weekProgress: number
  /** 一个周期的天数（周循环日历格子数） */
  weekLen: number
  /** 满一个周期的里程碑额外奖励云币 */
  milestoneReward: number
}

export interface SignInResult {
  balance: number
  reward: number
  alreadySigned: boolean
  dateKey: string
  isMember: boolean
  currentStreak: number
  longestStreak: number
  weekProgress: number
  weekLen: number
  milestoneReward: number
  /** 本次真正发放里程碑时非空，供前端庆祝 */
  milestone: { streak: number, bonus: number } | null
}

/** 签到历史中的一天（供热力图日历） */
export interface SignInDay {
  /** 东八区日期 key（YYYY-MM-DD） */
  dateKey: string
  /** 当天签到领取的云币（1 免费 / 2 会员） */
  coins: number
  isMember: boolean
  /** 当天是否达成 7 天里程碑 */
  milestone: boolean
}

export function useSignIn() {
  const { app } = useCloudbase()
  const { user } = useTcbAuth()
  const coin = useCoin()

  const status = useState<SignInStatus | null>('signin_status', () => null)
  const loading = ref(false)
  const submitting = ref(false)
  /** 自动领取去重：记录已尝试自动领取的 uid（每个用户每次会话仅一次） */
  const autoClaimedFor = useState<string | null>('signin_auto_claimed_uid', () => null)
  /** 签到历史（近一年），供热力图日历 */
  const history = useState<SignInDay[]>('signin_history', () => [])
  const historyLoading = ref(false)

  const signedToday = computed(() => !!status.value?.signedToday)
  const reward = computed(() => status.value?.reward ?? 1)
  const currentStreak = computed(() => status.value?.currentStreak ?? 0)
  const longestStreak = computed(() => status.value?.longestStreak ?? 0)
  const weekProgress = computed(() => status.value?.weekProgress ?? 0)
  const weekLen = computed(() => status.value?.weekLen ?? 7)
  const milestoneReward = computed(() => status.value?.milestoneReward ?? 10)

  /** 拉取今日签到态（只读） */
  async function fetchStatus(): Promise<SignInStatus | null> {
    if (!user.value || !app) {
      status.value = null
      return null
    }
    loading.value = true
    try {
      const res = await app.callFunction({
        name: 'account-api',
        data: { action: 'getSignInStatus' },
      })
      status.value = res.result as SignInStatus
      return status.value
    }
    catch (err) {
      console.warn('[useSignIn] fetchStatus failed:', err)
      return null
    }
    finally {
      loading.value = false
    }
  }

  /** 拉取签到历史（近一年，只读），供热力图日历 */
  async function fetchHistory(): Promise<SignInDay[]> {
    if (!user.value || !app) {
      history.value = []
      return []
    }
    historyLoading.value = true
    try {
      const res = await app.callFunction({
        name: 'account-api',
        data: { action: 'getSignInHistory' },
      })
      history.value = (res.result as { days?: SignInDay[] }).days ?? []
      return history.value
    }
    catch (err) {
      console.warn('[useSignIn] fetchHistory failed:', err)
      return []
    }
    finally {
      historyLoading.value = false
    }
  }

  /** 执行签到（幂等，当日重复返回 alreadySigned） */
  async function signIn(): Promise<SignInResult> {
    if (!user.value || !app)
      throw new Error('请先登录')
    submitting.value = true
    try {
      const res = await app.callFunction({
        name: 'account-api',
        data: { action: 'signIn' },
      })
      const result = res.result as SignInResult
      status.value = {
        signedToday: true,
        reward: result.reward,
        dateKey: result.dateKey,
        isMember: result.isMember,
        currentStreak: result.currentStreak,
        longestStreak: result.longestStreak,
        weekProgress: result.weekProgress,
        weekLen: result.weekLen,
        milestoneReward: result.milestoneReward,
      }
      await coin.refresh()
      return result
    }
    finally {
      submitting.value = false
    }
  }

  /**
   * 登录后自动领取今日签到（方案 B：去手动签到）。
   *
   * - 仅客户端、需真实登录态（匿名 uid 由 account-api 入口拦截，不会落到这里）
   * - 每个用户每次会话仅尝试一次（uid 维度去重），避免 onMounted 与 watch / 路由切换重复触发
   * - 复用幂等的 signIn —— 同一东八区自然日只入账一次，重复调用安全
   *
   * @returns 实际入账结果；已尝试过 / 未登录 / 失败时返回 null（由调用方决定是否 toast）
   */
  async function autoClaim(): Promise<SignInResult | null> {
    if (!import.meta.client)
      return null
    const uid = user.value?.id
    if (!uid || !app)
      return null
    if (autoClaimedFor.value === uid)
      return null
    autoClaimedFor.value = uid // 先占位，避免并发重复领取
    try {
      return await signIn()
    }
    catch (err) {
      autoClaimedFor.value = null // 失败放行，登录态再次变化时可重试（手动按钮亦可兜底）
      console.warn('[useSignIn] autoClaim failed:', err)
      return null
    }
  }

  return {
    status: readonly(status),
    signedToday,
    reward,
    currentStreak,
    longestStreak,
    weekProgress,
    weekLen,
    milestoneReward,
    history: readonly(history),
    historyLoading: readonly(historyLoading),
    loading: readonly(loading),
    submitting: readonly(submitting),
    fetchStatus,
    fetchHistory,
    signIn,
    autoClaim,
  }
}
