import type {
  BillingCycle,
  CreateOrderResult,
  PaymentPhase,
  PayType,
  PlanId,
  QueryOrderResult,
} from '~/types/payment'
import { PLAN_NAMES, PLAN_PRICES } from '~/types/payment'

const RE_MOBILE = /android|iphone|ipad|ipod|mobile/i
const POLLING_INTERVAL_MS = 5000
const POLLING_MAX_ATTEMPTS = 60 // 5 分钟
const PENDING_ORDER_KEY = 'wxpay:pending-order'

/** 微信 JSSDK 全局对象 */
declare const WeixinJSBridge: undefined | {
  invoke: (
    api: string,
    params: Record<string, string>,
    callback: (res: { err_msg: string }) => void,
  ) => void
}

interface PendingOrderSnapshot {
  outTradeNo: string
  payType: PayType
  planId: PlanId
  cycle: BillingCycle
  startedAt: number
}

/**
 * 检测当前支付环境
 * - 微信内浏览器 -> jsapi
 * - 移动端非微信且开启 H5 支付 -> h5
 * - 其他环境 -> native（扫码）
 */
export function detectPayType(): PayType {
  if (import.meta.server)
    return 'native'
  const ua = navigator.userAgent.toLowerCase()
  const isWechat = ua.includes('micromessenger')
  const isMobile = RE_MOBILE.test(ua)

  if (isWechat)
    return 'jsapi'
  if (isMobile) {
    const { enableH5Pay } = useRuntimeConfig().public
    if (enableH5Pay)
      return 'h5'
  }
  return 'native'
}

/**
 * 格式化金额（分 -> 元）
 */
export function formatPrice(amountInCents: number): string {
  return `¥${(amountInCents / 100).toFixed(2)}`
}

/** sessionStorage 安全读取，防止 SSR / 隐私模式异常 */
function readPendingOrder(): PendingOrderSnapshot | null {
  if (import.meta.server || typeof sessionStorage === 'undefined')
    return null
  try {
    const raw = sessionStorage.getItem(PENDING_ORDER_KEY)
    return raw ? (JSON.parse(raw) as PendingOrderSnapshot) : null
  }
  catch {
    return null
  }
}

function writePendingOrder(snapshot: PendingOrderSnapshot | null) {
  if (import.meta.server || typeof sessionStorage === 'undefined')
    return
  try {
    if (snapshot)
      sessionStorage.setItem(PENDING_ORDER_KEY, JSON.stringify(snapshot))
    else
      sessionStorage.removeItem(PENDING_ORDER_KEY)
  }
  catch {
    // ignore
  }
}

/**
 * 支付核心 composable
 */
export function usePayment() {
  const { app } = useCloudbase()
  const { user } = useTcbAuth()
  const membership = useMembership()
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
    if (!selectedPlan.value)
      return 0
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
    if (!selectedPlan.value)
      return
    if (!user.value) {
      toast.add({ title: '请先登录', color: 'warning' })
      navigateTo(`/login?redirect=/pricing`)
      return
    }
    if (!app) {
      errorMessage.value = '支付服务暂不可用，请刷新页面后重试'
      phase.value = 'fail'
      return
    }

    loading.value = true
    errorMessage.value = ''
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

      // 在跳转/调起前持久化订单快照，跳转回来后可恢复轮询
      writePendingOrder({
        outTradeNo: result.outTradeNo,
        payType,
        planId: selectedPlan.value,
        cycle: selectedCycle.value,
        startedAt: Date.now(),
      })

      if (payType === 'native') {
        startPolling(result.outTradeNo)
      }
      else if (payType === 'h5') {
        if (result.h5Url) {
          startPolling(result.outTradeNo)
          window.location.href = result.h5Url
        }
        else {
          throw new Error('未获取到 H5 支付链接')
        }
      }
      else if (payType === 'jsapi') {
        if (result.jsapiParams)
          invokeJsapi(result.jsapiParams, result.outTradeNo)
        else
          throw new Error('未获取到 JSAPI 支付参数')
      }
    }
    catch (err) {
      console.error('创建订单失败:', err)
      errorMessage.value = err instanceof Error ? err.message : '创建订单失败，请稍后重试'
      phase.value = 'fail'
      writePendingOrder(null)
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
      writePendingOrder(null)
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
          // 即使前端拿到 ok，仍以服务端确认为准（防止伪造客户端回调）
          startPolling(outTradeNo)
        }
        else if (res.err_msg === 'get_brand_wcpay_request:cancel') {
          errorMessage.value = '支付已取消'
          phase.value = 'fail'
          writePendingOrder(null)
        }
        else {
          // 异常分支：界面留在 paying，开轮询让服务端兜底确认
          phase.value = 'paying'
          startPolling(outTradeNo)
        }
      },
    )
  }

  /**
   * 轮询订单状态
   */
  function startPolling(outTradeNo: string) {
    if (!app)
      return
    stopPolling()

    let attempts = 0

    pollTimer = setInterval(async () => {
      attempts++
      if (attempts > POLLING_MAX_ATTEMPTS) {
        stopPolling()
        errorMessage.value = '支付状态未确认，请刷新页面或查看微信支付记录'
        phase.value = 'fail'
        writePendingOrder(null)
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
          writePendingOrder(null)
          // 异步刷新会员状态（不阻塞 UI）
          membership.refresh().catch(() => {})
        }
        else if (result.status === 'failed' || result.status === 'closed') {
          stopPolling()
          errorMessage.value = result.status === 'closed' ? '支付已关闭' : '支付失败'
          phase.value = 'fail'
          writePendingOrder(null)
        }
      }
      catch (err) {
        console.warn('查询订单状态失败:', err)
        // 单次失败不停止轮询
      }
    }, POLLING_INTERVAL_MS)
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
    writePendingOrder(null)
  }

  /**
   * 恢复中断的支付（H5 跳转回来后调用）
   */
  function resumePendingOrder(): PendingOrderSnapshot | null {
    const snapshot = readPendingOrder()
    if (!snapshot)
      return null
    // 已超过最长轮询窗口的快照直接丢弃
    if (Date.now() - snapshot.startedAt > POLLING_INTERVAL_MS * POLLING_MAX_ATTEMPTS) {
      writePendingOrder(null)
      return null
    }
    selectedPlan.value = snapshot.planId
    selectedCycle.value = snapshot.cycle
    currentOrder.value = { outTradeNo: snapshot.outTradeNo, payType: snapshot.payType }
    phase.value = 'paying'
    startPolling(snapshot.outTradeNo)
    return snapshot
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
    resumePendingOrder,
  }
}
