import type {
  BillingCycle,
  MembershipLevel,
} from '~/types/payment'
import { formatPrice, usePaymentFlow } from '~/composables/usePaymentFlow'
import { PLAN_NAMES, PLAN_PRICES } from '~/types/payment'

const PENDING_ORDER_KEY = 'wxpay:pending-order'

/**
 * 会员订阅支付 composable。
 *
 * 业务状态（选中套餐/周期、价格展示）在此维护，
 * 下单/轮询/恢复等通用支付流程委托给 usePaymentFlow。
 */
export function usePayment() {
  const { user } = useTcbAuth()
  const membership = useMembership()
  const toast = useToast()

  const flow = usePaymentFlow({
    pendingKey: PENDING_ORDER_KEY,
    onPaid: () => membership.refresh({ throwOnError: true }),
  })

  // 选中的套餐信息
  const selectedPlan = ref<MembershipLevel | null>(null)
  const selectedCycle = ref<BillingCycle>('month')

  const selectedPlanName = computed(() =>
    selectedPlan.value ? PLAN_NAMES[selectedPlan.value] : '',
  )

  const selectedPlanPrice = computed(() => {
    if (!selectedPlan.value)
      return 0
    return PLAN_PRICES[selectedPlan.value][selectedCycle.value]
  })

  const selectedPlanPriceFormatted = computed(() =>
    formatPrice(selectedPlanPrice.value),
  )

  /** 选择套餐，回到确认阶段 */
  function selectPlan(planId: MembershipLevel, cycle: BillingCycle) {
    selectedPlan.value = planId
    selectedCycle.value = cycle
    flow.prepareConfirm()
  }

  /** 创建订单并发起支付 */
  async function createOrder() {
    if (!selectedPlan.value)
      return
    if (!user.value) {
      toast.add({ title: '请先登录', color: 'warning' })
      navigateTo(`/login?redirect=/pricing`)
      return
    }
    await flow.createPayment(
      {
        orderType: 'membership',
        appId: 'yunle',
        level: selectedPlan.value,
        billingCycle: selectedCycle.value,
      },
      { planId: selectedPlan.value, cycle: selectedCycle.value },
    )
  }

  /** 重置状态 */
  function reset() {
    flow.reset()
  }

  /** 恢复中断的支付（H5 跳转回来后调用） */
  function resumePendingOrder() {
    const meta = flow.resume()
    if (!meta)
      return null
    if (meta.planId)
      selectedPlan.value = meta.planId as MembershipLevel
    if (meta.cycle)
      selectedCycle.value = meta.cycle as BillingCycle
    return meta
  }

  return {
    phase: flow.phase,
    loading: flow.loading,
    currentOrder: flow.currentOrder,
    errorMessage: flow.errorMessage,
    selectedPlan,
    selectedCycle,
    selectedPlanName,
    selectedPlanPrice,
    selectedPlanPriceFormatted,
    selectPlan,
    createOrder,
    reset,
    stopPolling: flow.stopPolling,
    resumePendingOrder,
  }
}
