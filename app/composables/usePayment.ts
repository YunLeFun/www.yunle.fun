import type {
  BillingCycle,
  CreateOrderResult,
  PayType,
  PaymentPhase,
  PlanId,
  QueryOrderResult,
} from '~/types/payment'
import { PLAN_NAMES, PLAN_PRICES } from '~/types/payment'

/**
 * 检测当前支付环境
 * - 微信内浏览器 -> jsapi
 * - 移动端非微信且开启 H5 支付 -> h5
 * - 其他环境 -> native（扫码）
 */
export function detectPayType(): PayType {
  if (import.meta.server) return 'native'
  const ua = navigator.userAgent.toLowerCase()
  const isWechat = ua.includes('micromessenger')
  const isMobile = /android|iphone|ipad|ipod|mobile/i.test(ua)

  if (isWechat) return 'jsapi'
  if (isMobile) {
    const { enableH5Pay } = useRuntimeConfig().public
    if (enableH5Pay) return 'h5'
  }
  return 'native'
}

/**
 * 格式化金额（分 -> 元）
 */
export function formatPrice(amountInCents: number): string {
  return `¥${(amountInCents / 100).toFixed(2)}`
}

/**
 * 支付核心 composable
 */
export function usePayment() {
  const { app } = useCloudbase()
  const { user } = useTcbAuth()
  const toast = useToast()

  const phase = ref<PaymentPhase>('confirm')
  const loading = ref(false)
  const currentOrder = ref<CreateOrderResult | null>(null)
  const errorMessage = ref('')

  // 选中的套餐信息
  const selectedPlan = ref<PlanId | null>(null)
  const selectedCycle = ref<BillingCycle>('month')

  // 轮询定时器
  let pollTimer: ReturnType<typeof setInterval> | null = null

  const selectedPlanName = computed(() =>
    selectedPlan.value ? PLAN_NAMES[selectedPlan.value] : '',
  )

  const selectedPlanPrice = computed(() => {
    if (!selectedPlan.value) return 0
    return PLAN_PRICES[selectedPlan.value][selectedCycle.value]
  })

  const selectedPlanPriceFormatted = computed(() =>
    formatPrice(selectedPlanPrice.value),
  )

  /**
   * 选择套餐，打开支付弹窗
   */
  function selectPlan(planId: PlanId, cycle: BillingCycle) {
    selectedPlan.value = planId
    selectedCycle.value = cycle
    phase.value = 'confirm'
    currentOrder.value = null
    errorMessage.value = ''
  }

  /**
   * 创建订单并发起支付
   */
  async function createOrder() {
    if (!selectedPlan.value) return
    if (!user.value) {
      toast.add({ title: '请先登录', color: 'warning' })
      navigateTo(`/login?redirect=/pricing`)
      return
    }

    loading.value = true
    const payType = detectPayType()

    try {
      const res = await app.callFunction({
        name: 'wxpay-order',
        data: {
          action: 'createOrder',
          planId: selectedPlan.value,
          billingCycle: selectedCycle.value,
          payType,
        },
      })

      const result = res.result as CreateOrderResult
      currentOrder.value = result
      phase.value = 'paying'

      // 根据支付方式处理
      if (payType === 'native') {
        // Native 扫码支付：前端展示二维码，启动轮询
        startPolling(result.outTradeNo)
      }
      else if (payType === 'h5') {
        // H5 支付：跳转微信
        if (result.h5Url) {
          startPolling(result.outTradeNo)
          window.location.href = result.h5Url
        }
      }
      else if (payType === 'jsapi') {
        // JSAPI 支付：通过 WeixinJSBridge 调起支付
        if (result.jsapiParams) {
          invokeJsapi(result.jsapiParams, result.outTradeNo)
        }
      }
    }
    catch (err) {
      console.error('创建订单失败:', err)
      errorMessage.value = err instanceof Error ? err.message : '创建订单失败，请稍后重试'
      phase.value = 'fail'
    }
    finally {
      loading.value = false
    }
  }

  /**
   * JSAPI 调起微信支付
   */
  function invokeJsapi(params: NonNullable<CreateOrderResult['jsapiParams']>, outTradeNo: string) {
    if (typeof WeixinJSBridge === 'undefined') {
      errorMessage.value = '请在微信浏览器中使用 JSAPI 支付'
      phase.value = 'fail'
      return
    }

    WeixinJSBridge.invoke(
      'getBrandWCPayRequest',
      {
        appId: params.appId,
        timeStamp: params.timeStamp,
        nonceStr: params.nonceStr,
        package: params.package,
        signType: params.signType,
        paySign: params.paySign,
      },
      (res: { err_msg: string }) => {
        if (res.err_msg === 'get_brand_wcpay_request:ok') {
          phase.value = 'success'
        }
        else if (res.err_msg === 'get_brand_wcpay_request:cancel') {
          errorMessage.value = '支付已取消'
          phase.value = 'fail'
        }
        else {
          // 支付可能成功但前端未确认，启动轮询
          startPolling(outTradeNo)
        }
      },
    )
  }

  /**
   * 轮询订单状态
   */
  function startPolling(outTradeNo: string) {
    stopPolling()

    let attempts = 0
    const maxAttempts = 60 // 最多轮询 5 分钟 (每 5 秒一次)

    pollTimer = setInterval(async () => {
      attempts++
      if (attempts > maxAttempts) {
        stopPolling()
        errorMessage.value = '支付超时，请查看微信支付是否成功'
        phase.value = 'fail'
        return
      }

      try {
        const res = await app.callFunction({
          name: 'wxpay-order',
          data: {
            action: 'queryOrder',
            outTradeNo,
          },
        })

        const result = res.result as QueryOrderResult
        if (result.status === 'paid') {
          stopPolling()
          phase.value = 'success'
        }
        else if (result.status === 'failed' || result.status === 'closed') {
          stopPolling()
          errorMessage.value = '支付失败或已关闭'
          phase.value = 'fail'
        }
      }
      catch (err) {
        console.error('查询订单状态失败:', err)
      }
    }, 5000)
  }

  /**
   * 停止轮询
   */
  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  /**
   * 重置状态
   */
  function reset() {
    stopPolling()
    phase.value = 'confirm'
    currentOrder.value = null
    errorMessage.value = ''
    loading.value = false
  }

  // 组件卸载时清理
  onUnmounted(() => {
    stopPolling()
  })

  return {
    phase,
    loading,
    currentOrder,
    errorMessage,
    selectedPlan,
    selectedCycle,
    selectedPlanName,
    selectedPlanPrice,
    selectedPlanPriceFormatted,
    selectPlan,
    createOrder,
    reset,
    stopPolling,
  }
}

// WeixinJSBridge 类型声明
declare const WeixinJSBridge: {
  invoke: (
    api: string,
    params: Record<string, string>,
    callback: (res: { err_msg: string }) => void,
  ) => void
}
