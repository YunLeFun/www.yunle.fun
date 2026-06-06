import type {
  CreateOrderResult,
  PaymentPhase,
  PayType,
  QueryOrderResult,
} from '~/types/payment'

const RE_MOBILE = /android|iphone|ipad|ipod|mobile/i
const POLLING_INTERVAL_MS = 5000
const POLLING_MAX_ATTEMPTS = 60 // 5 分钟

/** 微信 JSSDK 全局对象 */
declare const WeixinJSBridge: undefined | {
  invoke: (
    api: string,
    params: Record<string, string>,
    callback: (res: { err_msg: string }) => void,
  ) => void
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

/** 格式化金额（分 -> 元） */
export function formatPrice(amountInCents: number): string {
  return `¥${(amountInCents / 100).toFixed(2)}`
}

/** 中断支付的持久化快照（H5 跳转后恢复轮询用） */
export interface PaymentFlowSnapshot {
  outTradeNo: string
  payType: PayType
  startedAt: number
  /** 业务自定义恢复字段（如套餐/云币包标识），由各业务流自行解释 */
  meta?: Record<string, unknown>
}

export interface UsePaymentFlowOptions {
  /** sessionStorage 持久化键，不同业务流必须用不同 key 以免快照串台 */
  pendingKey: string
  /** 支付成功后的副作用（如刷新会员 / 刷新余额），不阻塞 UI */
  onPaid?: () => void | Promise<void>
}

/**
 * 支付流程核心（与具体业务解耦）。
 *
 * 封装「下单 -> native 扫码 / h5 跳转 / jsapi 调起 -> 轮询确认 -> 成功/失败」整条状态机，
 * 以及中断恢复。会员订阅、云币充值等业务复用同一份逻辑，只需传入各自的下单 data 与恢复 meta。
 */
export function usePaymentFlow(options: UsePaymentFlowOptions) {
  const { app } = useCloudbase()

  const phase = ref<PaymentPhase>('confirm')
  const loading = ref(false)
  const currentOrder = ref<CreateOrderResult | null>(null)
  const errorMessage = ref('')

  let pollTimer: ReturnType<typeof setInterval> | null = null

  function readPending(): PaymentFlowSnapshot | null {
    if (import.meta.server || typeof sessionStorage === 'undefined')
      return null
    try {
      const raw = sessionStorage.getItem(options.pendingKey)
      return raw ? (JSON.parse(raw) as PaymentFlowSnapshot) : null
    }
    catch {
      return null
    }
  }

  function writePending(snapshot: PaymentFlowSnapshot | null) {
    if (import.meta.server || typeof sessionStorage === 'undefined')
      return
    try {
      if (snapshot)
        sessionStorage.setItem(options.pendingKey, JSON.stringify(snapshot))
      else
        sessionStorage.removeItem(options.pendingKey)
    }
    catch {
      // ignore
    }
  }

  /** 回到「确认」阶段（仅复位展示状态，不动持久化/轮询） */
  function prepareConfirm() {
    phase.value = 'confirm'
    currentOrder.value = null
    errorMessage.value = ''
  }

  /**
   * 下单并发起支付。
   *
   * @param orderData 透传给 wxpay-order createOrder 的业务字段（orderType / appId / 套餐等）
   * @param meta 中断恢复时需要还原的业务展示字段
   */
  async function createPayment(
    orderData: Record<string, unknown>,
    meta?: Record<string, unknown>,
  ) {
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
        data: { action: 'createOrder', payType, ...orderData },
      })

      const result = res.result as CreateOrderResult
      currentOrder.value = result
      phase.value = 'paying'

      writePending({ outTradeNo: result.outTradeNo, payType, startedAt: Date.now(), meta })

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
      writePending(null)
    }
    finally {
      loading.value = false
    }
  }

  /** JSAPI 调起微信支付 */
  function invokeJsapi(params: NonNullable<CreateOrderResult['jsapiParams']>, outTradeNo: string) {
    if (typeof WeixinJSBridge === 'undefined') {
      errorMessage.value = '请在微信浏览器中使用 JSAPI 支付'
      phase.value = 'fail'
      writePending(null)
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
          startPolling(outTradeNo)
        }
        else if (res.err_msg === 'get_brand_wcpay_request:cancel') {
          errorMessage.value = '支付已取消'
          phase.value = 'fail'
          writePending(null)
        }
        else {
          phase.value = 'paying'
          startPolling(outTradeNo)
        }
      },
    )
  }

  /** 轮询订单状态 */
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
        writePending(null)
        return
      }

      try {
        const res = await app.callFunction({
          name: 'wxpay-order',
          data: { action: 'queryOrder', outTradeNo },
        })
        const result = res.result as QueryOrderResult
        if (result.status === 'paid') {
          stopPolling()
          phase.value = 'success'
          writePending(null)
          Promise.resolve(options.onPaid?.()).catch(() => {})
        }
        else if (result.status === 'failed' || result.status === 'closed') {
          stopPolling()
          errorMessage.value = result.status === 'closed' ? '支付已关闭' : '支付失败'
          phase.value = 'fail'
          writePending(null)
        }
      }
      catch (err) {
        console.warn('查询订单状态失败:', err)
      }
    }, POLLING_INTERVAL_MS)
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
  }

  /** 完整复位（关闭弹窗时调用） */
  function reset() {
    stopPolling()
    phase.value = 'confirm'
    currentOrder.value = null
    errorMessage.value = ''
    loading.value = false
    writePending(null)
  }

  /**
   * 恢复中断的支付（H5 跳转回来后调用）。
   * @returns 命中则返回快照 meta，否则 null
   */
  function resume(): Record<string, unknown> | null {
    const snapshot = readPending()
    if (!snapshot)
      return null
    if (Date.now() - snapshot.startedAt > POLLING_INTERVAL_MS * POLLING_MAX_ATTEMPTS) {
      writePending(null)
      return null
    }
    currentOrder.value = { outTradeNo: snapshot.outTradeNo, payType: snapshot.payType }
    phase.value = 'paying'
    startPolling(snapshot.outTradeNo)
    return snapshot.meta ?? {}
  }

  onUnmounted(() => {
    stopPolling()
  })

  return {
    phase,
    loading,
    currentOrder,
    errorMessage,
    prepareConfirm,
    createPayment,
    stopPolling,
    reset,
    resume,
  }
}
