/** 支付方式 */
export type PayType = 'native' | 'jsapi' | 'h5'

/** 订单状态 */
export type OrderStatus = 'pending' | 'paid' | 'failed' | 'closed' | 'refunded'

/** 套餐标识 */
export type PlanId = 'basic'

/** 计费周期 */
export type BillingCycle = 'month' | 'year'

/** 套餐价格表（单位：分） */
export const PLAN_PRICES: Record<PlanId, Record<BillingCycle, number>> = {
  basic: { month: 990, year: 9990 },
}

/** 套餐显示名称 */
export const PLAN_NAMES: Record<PlanId, string> = {
  basic: '云乐坊会员',
}

/** 订单记录 */
export interface OrderRecord {
  _id: string
  userId: string
  planId: PlanId
  billingCycle: BillingCycle
  /** 金额（分） */
  amount: number
  payType: PayType
  status: OrderStatus
  outTradeNo: string
  transactionId?: string
  /** Native 支付二维码链接 */
  codeUrl?: string
  /** H5 支付跳转链接 */
  h5Url?: string
  /** JSAPI 支付预付单 ID */
  prepayId?: string
  /** JSAPI 支付参数（前端调起支付用） */
  jsapiParams?: {
    appId: string
    timeStamp: string
    nonceStr: string
    package: string
    signType: string
    paySign: string
  }
  createdAt: number
  paidAt?: number
  updatedAt: number
}

/** 创建订单参数 */
export interface CreateOrderParams {
  planId: PlanId
  billingCycle: BillingCycle
  payType: PayType
  /** JSAPI 支付需要的微信 openid */
  wxOpenid?: string
}

/** 支付弹窗阶段 */
export type PaymentPhase = 'confirm' | 'paying' | 'success' | 'fail'

/** 下单返回结果 */
export interface CreateOrderResult {
  orderId: string
  outTradeNo: string
  payType: PayType
  /** Native 支付二维码链接 */
  codeUrl?: string
  /** H5 支付跳转链接 */
  h5Url?: string
  /** JSAPI 支付参数 */
  jsapiParams?: OrderRecord['jsapiParams']
}

/** 查询订单返回结果 */
export interface QueryOrderResult {
  status: OrderStatus
  transactionId?: string
  paidAt?: number
}
