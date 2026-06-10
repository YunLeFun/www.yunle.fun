/**
 * 支付相关类型与常量已全部收敛到 @yunlefun/types（YunLeFun/ylf 仓库），
 * 此处纯 re-export 保持原 `~/types/payment` 引用路径不变。
 *
 * 注意：PLAN_PRICES / COIN_* 常量的服务端真相源在 functions/wxpay-order/lib/plans.js
 *（CJS 独立部署），修改时必须同步 @yunlefun/types 与该文件及其 lib 副本。
 */
export type {
  AccountSnapshot,
  BillingCycle,
  CoinPackId,
  CoinTransaction,
  CreateMembershipOrderParams,
  CreateOrderParams,
  CreateOrderResult,
  CreateRechargeOrderParams,
  MembershipLevel,
  OrderRecord,
  OrderStatus,
  OrderType,
  PaymentPhase,
  PayType,
  PlanId,
  QueryOrderResult,
} from '@yunlefun/types'

export {
  COIN_CUSTOM_MAX,
  COIN_CUSTOM_MIN,
  COIN_PACKS,
  COIN_RATE_FEN,
  PLAN_FEATURES,
  PLAN_NAMES,
  PLAN_PRICES,
} from '@yunlefun/types'
