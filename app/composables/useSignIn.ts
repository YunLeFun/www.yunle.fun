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
}

export interface SignInResult {
  balance: number
  reward: number
  alreadySigned: boolean
  dateKey: string
}

export function useSignIn() {
  const { app } = useCloudbase()
  const { user } = useTcbAuth()
  const coin = useCoin()

  const status = useState<SignInStatus | null>('signin_status', () => null)
  const loading = ref(false)
  const submitting = ref(false)

  const signedToday = computed(() => !!status.value?.signedToday)
  const reward = computed(() => status.value?.reward ?? 1)

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
        isMember: status.value?.isMember ?? false,
      }
      await coin.refresh()
      return result
    }
    finally {
      submitting.value = false
    }
  }

  return {
    status: readonly(status),
    signedToday,
    reward,
    loading: readonly(loading),
    submitting: readonly(submitting),
    fetchStatus,
    signIn,
  }
}
