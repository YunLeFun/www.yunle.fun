/** 支付方式 */
export type PayType = 'native' | 'jsapi' | 'h5'

/** 订单状态 */
export type OrderStatus = 'pending' | 'paid' | 'failed' | 'closed' | 'refunded'

/** 会员等级标识（兼容旧称 PlanId） */
export type MembershipLevel = 'basic'
/** @deprecated 改用 MembershipLevel，保留别名兼容旧代码 */
export type PlanId = MembershipLevel

/** 订单类型：会员订阅 / 云币充值 */
export type OrderType = 'membership' | 'recharge_coin'

/** 计费周期 */
export type BillingCycle = 'month' | 'year'

/** 会员套餐价格表（单位：分），与 functions/.../lib/plans.js 的 PLAN_PRICES 同步 */
export const PLAN_PRICES: Record<MembershipLevel, Record<BillingCycle, number>> = {
  basic: { month: 990, year: 9990 },
}

/** 套餐显示名称 */
export const PLAN_NAMES: Record<MembershipLevel, string> = {
  basic: '云乐坊会员',
}

/** 云币汇率：1 云币 = 10 分（100 云币 = 10 元），与 lib/plans.js 的 COIN_RATE_FEN 同步 */
export const COIN_RATE_FEN = 10

/** 自定义充值云币数量下限（与 lib/plans.js 的 COIN_CUSTOM_MIN 同步） */
export const COIN_CUSTOM_MIN = 100

/** 自定义充值云币数量上限（与 lib/plans.js 的 COIN_CUSTOM_MAX 同步） */
export const COIN_CUSTOM_MAX = 100_000

/** 云币充值套餐标识 */
export type CoinPackId = 'coin_100' | 'coin_500' | 'coin_1000'

/** 云币充值套餐表：packId -> { amount(分), coin }，与 lib/plans.js 的 COIN_PACKS 同步 */
export const COIN_PACKS: Record<CoinPackId, { amount: number, coin: number }> = {
  coin_100: { amount: 1000, coin: 100 },
  coin_500: { amount: 5000, coin: 500 },
  coin_1000: { amount: 10000, coin: 1000 },
}

/** 账户全貌（account-api getAccount 返回） */
export interface AccountSnapshot {
  /** 云币余额 */
  coin: number
  membership: {
    isActive: boolean
    level: MembershipLevel | null
    expireAt: number | null
  }
}

/** 云币流水记录 */
export interface CoinTransaction {
  _id: string
  userId: string
  appId: string
  type: 'recharge' | 'consume' | 'refund' | 'gift'
  /** 正=入账，负=扣减 */
  amount: number
  balanceAfter: number
  refId: string
  meta?: Record<string, unknown>
  createdAt: number
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

/** 创建会员订单参数 */
export interface CreateMembershipOrderParams {
  orderType?: 'membership'
  /** 应用标识（多租户归属），如 'yunle' */
  appId: string
  /** 会员等级（兼容旧字段 planId） */
  level: MembershipLevel
  billingCycle: BillingCycle
  payType: PayType
  /** JSAPI 支付需要的微信 openid */
  wxOpenid?: string
}

/** 创建云币充值订单参数（packId 与 coin 二选一） */
export interface CreateRechargeOrderParams {
  orderType: 'recharge_coin'
  appId: string
  /** 预设充值套餐 */
  packId?: CoinPackId
  /** 自定义充值云币数量（金额由服务端按汇率计算） */
  coin?: number
  payType: PayType
  wxOpenid?: string
}

/** 创建订单参数 */
export type CreateOrderParams = CreateMembershipOrderParams | CreateRechargeOrderParams

/** 支付弹窗阶段 */
export type PaymentPhase = 'confirm' | 'paying' | 'success' | 'fail'

/** 下单返回结果 */
export interface CreateOrderResult {
  /** 数据库订单 ID。H5 跳转回来恢复时可能不可用，因此设为可选。 */
  orderId?: string
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
