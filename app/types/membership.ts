import type { BillingCycle, PlanId } from './payment'

/** 会员状态（来自 user_memberships 集合） */
export interface MembershipRecord {
  _id: string
  userId: string
  planId: PlanId
  activeCycle: BillingCycle
  /** 会员到期时间戳（ms） */
  expireAt: number
  lastOrderId?: string
  createdAt: number
  updatedAt: number
}

/** 前端会员状态（含派生字段） */
export interface MembershipState extends MembershipRecord {
  /** 是否仍然有效 */
  active: boolean
  /** 距离到期剩余毫秒数（>=0） */
  remainingMs: number
}
