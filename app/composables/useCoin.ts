import type { AccountSnapshot, CoinTransaction } from '~/types/payment'

// 展示工具已收敛到 @yunlefun/types，re-export 保持原引用路径（wallet.vue 等）不变
export { COIN_TX_TYPE_NAMES, formatCoin } from '@yunlefun/types'

/** 订单摘要（account-api listOrders 的脱敏投影），供钱包「订单历史」展示 */
export interface OrderSummary {
  id: string
  orderType: 'membership' | 'recharge_coin' | (string & {})
  appId: string
  /** 金额（分） */
  amount: number
  status: 'pending' | 'paid' | 'failed' | 'refunded' | 'closed' | (string & {})
  payType: string
  /** 会员单 */
  level: string | null
  billingCycle: string | null
  /** 云币充值单 */
  coinAmount: number | null
  packId: string | null
  createdAt: number
  paidAt: number | null
}

/**
 * 平台账户 composable（云币余额 + 会员状态 + 流水）。
 *
 * - 对接 account-api 云函数
 * - 全局共享：通过 useState 在多个组件间复用同一份账户快照
 * - 与登录态联动：用户变化时自动刷新 / 清空
 */
export function useCoin() {
  const { app } = useCloudbase()
  const { user } = useTcbAuth()

  const account = useState<AccountSnapshot | null>('coin_account', () => null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  const balance = computed(() => account.value?.coin ?? 0)
  const membership = computed(() => account.value?.membership ?? null)
  const isMember = computed(() => !!account.value?.membership.isActive)

  /** 拉取账户全貌（余额 + 会员） */
  async function refresh(): Promise<AccountSnapshot | null> {
    if (!user.value || !app) {
      account.value = null
      return null
    }
    loading.value = true
    error.value = null
    try {
      const res = await app.callFunction({
        name: 'account-api',
        data: { action: 'getAccount' },
      })
      account.value = res.result as AccountSnapshot
      return account.value
    }
    catch (err) {
      error.value = err instanceof Error ? err.message : '获取账户失败'
      console.warn('[useCoin] refresh failed:', err)
      return account.value
    }
    finally {
      loading.value = false
    }
  }

  /**
   * 扣减云币（供各子应用按次消费调用）。
   *
   * @param params 扣费参数
   * @param params.appId 业务应用标识
   * @param params.amount 扣减云币数（正整数）
   * @param params.bizId 业务幂等键（同一 bizId 只扣一次）
   * @param params.meta 业务自定义信息
   */
  async function deduct(params: {
    appId: string
    amount: number
    bizId: string
    meta?: Record<string, unknown>
  }): Promise<{ balance: number, deduped: boolean }> {
    if (!app)
      throw new Error('账户服务暂不可用')
    const res = await app.callFunction({
      name: 'account-api',
      data: { action: 'deductCoin', ...params },
    })
    const result = res.result as { balance: number, deduped: boolean }
    // 同步本地余额
    if (account.value)
      account.value = { ...account.value, coin: result.balance }
    return result
  }

  /**
   * 兜底对账：让服务端把当前用户卡在 pending 的订单逐一向微信核对并补发权益。
   *
   * 用于「支付成功但前端轮询窗口已关闭 / 异步回调漏达」的自愈：进入钱包页时调用一次，
   * 把漏发的云币 / 会员补回来。返回本次确认为已支付的订单数。
   */
  async function reconcileOrders(): Promise<{ reconciled: number, paid: number }> {
    if (!user.value || !app)
      return { reconciled: 0, paid: 0 }
    try {
      const res = await app.callFunction({
        name: 'wxpay-order',
        data: { action: 'reconcileOrders' },
      })
      return res.result as { reconciled: number, paid: number }
    }
    catch (err) {
      console.warn('[useCoin] reconcile failed:', err)
      return { reconciled: 0, paid: 0 }
    }
  }

  /** 云币流水分页（按时间倒序） */
  async function listTransactions(params: { skip?: number, limit?: number } = {}): Promise<{
    items: CoinTransaction[]
    nextSkip: number | null
  }> {
    if (!app)
      return { items: [], nextSkip: null }
    const res = await app.callFunction({
      name: 'account-api',
      data: { action: 'listTransactions', skip: params.skip ?? 0, limit: params.limit ?? 20 },
    })
    return res.result as { items: CoinTransaction[], nextSkip: number | null }
  }

  /** 订单历史分页（会员 / 云币充值订单，按时间倒序） */
  async function listOrders(params: { skip?: number, limit?: number } = {}): Promise<{
    items: OrderSummary[]
    nextSkip: number | null
  }> {
    if (!app)
      return { items: [], nextSkip: null }
    const res = await app.callFunction({
      name: 'account-api',
      data: { action: 'listOrders', skip: params.skip ?? 0, limit: params.limit ?? 10 },
    })
    return res.result as { items: OrderSummary[], nextSkip: number | null }
  }

  // 用户变化时自动刷新
  watch(
    () => user.value?.id,
    (newId, oldId) => {
      if (newId !== oldId) {
        if (newId)
          refresh()
        else
          account.value = null
      }
    },
    { immediate: false },
  )

  return {
    account: readonly(account),
    balance,
    membership,
    isMember,
    loading: readonly(loading),
    error: readonly(error),
    refresh,
    deduct,
    reconcileOrders,
    listTransactions,
    listOrders,
  }
}
