import type { CoinPackId } from '~/types/payment'
import { formatPrice, usePaymentFlow } from '~/composables/usePaymentFlow'
import { COIN_PACKS, COIN_RATE_FEN } from '~/types/payment'

const PENDING_RECHARGE_KEY = 'wxpay:pending-recharge'

/**
 * 云币充值支付 composable。
 *
 * 复用 usePaymentFlow 的下单/轮询/恢复逻辑，业务上只关注「选哪个充值包」。
 * 支付成功后自动刷新账户余额。
 */
export function useCoinRecharge() {
  const { user } = useTcbAuth()
  const coin = useCoin()
  const toast = useToast()

  const flow = usePaymentFlow({
    pendingKey: PENDING_RECHARGE_KEY,
    onPaid: () => {
      coin.refresh().catch(() => {})
    },
  })

  const selectedPack = ref<CoinPackId | null>(null)
  /** 自定义充值云币数量（与 selectedPack 互斥） */
  const customCoin = ref<number | null>(null)

  const selectedPackInfo = computed(() =>
    selectedPack.value ? COIN_PACKS[selectedPack.value] : null,
  )
  const isCustom = computed(() => customCoin.value != null)
  const selectedCoin = computed(() =>
    isCustom.value ? (customCoin.value ?? 0) : (selectedPackInfo.value?.coin ?? 0),
  )
  const selectedPrice = computed(() =>
    isCustom.value ? selectedCoin.value * COIN_RATE_FEN : (selectedPackInfo.value?.amount ?? 0),
  )
  const selectedPriceFormatted = computed(() => formatPrice(selectedPrice.value))

  /** 选择预设充值包，回到确认阶段 */
  function selectPack(packId: CoinPackId) {
    selectedPack.value = packId
    customCoin.value = null
    flow.prepareConfirm()
  }

  /** 选择自定义充值数量，回到确认阶段 */
  function selectCustom(coin: number) {
    customCoin.value = coin
    selectedPack.value = null
    flow.prepareConfirm()
  }

  /** 创建充值订单并发起支付 */
  async function createOrder() {
    if (!selectedPack.value && customCoin.value == null)
      return
    if (!user.value) {
      toast.add({ title: '请先登录', color: 'warning' })
      navigateTo(`/login?redirect=/wallet`)
      return
    }
    const orderData = selectedPack.value
      ? { orderType: 'recharge_coin' as const, appId: 'yunle', packId: selectedPack.value }
      : { orderType: 'recharge_coin' as const, appId: 'yunle', coin: customCoin.value as number }
    await flow.createPayment(
      orderData,
      { packId: selectedPack.value, coin: customCoin.value },
    )
  }

  function reset() {
    flow.reset()
  }

  /** 恢复中断的充值（H5 跳转回来后调用） */
  function resumePending() {
    const meta = flow.resume()
    if (!meta)
      return null
    if (meta.packId)
      selectedPack.value = meta.packId as CoinPackId
    else if (typeof meta.coin === 'number')
      customCoin.value = meta.coin
    return meta
  }

  return {
    phase: flow.phase,
    loading: flow.loading,
    currentOrder: flow.currentOrder,
    errorMessage: flow.errorMessage,
    selectedPack,
    selectedPackInfo,
    customCoin,
    isCustom,
    selectedPrice,
    selectedCoin,
    selectedPriceFormatted,
    selectPack,
    selectCustom,
    createOrder,
    reset,
    stopPolling: flow.stopPolling,
    resumePending,
  }
}
