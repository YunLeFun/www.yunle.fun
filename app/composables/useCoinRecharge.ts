import type { CoinPackId } from '~/types/payment'
import { formatPrice, usePaymentFlow } from '~/composables/usePaymentFlow'
import { COIN_PACKS } from '~/types/payment'

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

  const selectedPackInfo = computed(() =>
    selectedPack.value ? COIN_PACKS[selectedPack.value] : null,
  )
  const selectedPrice = computed(() => selectedPackInfo.value?.amount ?? 0)
  const selectedCoin = computed(() => selectedPackInfo.value?.coin ?? 0)
  const selectedPriceFormatted = computed(() => formatPrice(selectedPrice.value))

  /** 选择充值包，回到确认阶段 */
  function selectPack(packId: CoinPackId) {
    selectedPack.value = packId
    flow.prepareConfirm()
  }

  /** 创建充值订单并发起支付 */
  async function createOrder() {
    if (!selectedPack.value)
      return
    if (!user.value) {
      toast.add({ title: '请先登录', color: 'warning' })
      navigateTo(`/login?redirect=/wallet`)
      return
    }
    await flow.createPayment(
      {
        orderType: 'recharge_coin',
        appId: 'yunle',
        packId: selectedPack.value,
      },
      { packId: selectedPack.value },
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
    return meta
  }

  return {
    phase: flow.phase,
    loading: flow.loading,
    currentOrder: flow.currentOrder,
    errorMessage: flow.errorMessage,
    selectedPack,
    selectedPackInfo,
    selectedPrice,
    selectedCoin,
    selectedPriceFormatted,
    selectPack,
    createOrder,
    reset,
    stopPolling: flow.stopPolling,
    resumePending,
  }
}
