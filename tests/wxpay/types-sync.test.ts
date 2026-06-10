import {
  COIN_CUSTOM_MAX,
  COIN_CUSTOM_MIN,
  COIN_PACKS,
  COIN_RATE_FEN,
  PLAN_PRICES,
} from '@yunlefun/types'
import { describe, expect, it } from 'vitest'

import * as plans from '../../functions/wxpay-order/lib/plans.js'

/**
 * @yunlefun/types（前端共享常量）与 functions/wxpay-order/lib/plans.js
 * （服务端真相源，CJS 独立部署无法直接 import npm 包）必须保持手动同步。
 * 此测试在两者漂移时让 CI 失败。
 */
describe('@yunlefun/types 与 lib/plans.js 常量同步', () => {
  it('会员价格表一致', () => {
    expect(PLAN_PRICES).toEqual(plans.PLAN_PRICES)
  })

  it('云币汇率与自定义充值上下限一致', () => {
    expect(COIN_RATE_FEN).toBe(plans.COIN_RATE_FEN)
    expect(COIN_CUSTOM_MIN).toBe(plans.COIN_CUSTOM_MIN)
    expect(COIN_CUSTOM_MAX).toBe(plans.COIN_CUSTOM_MAX)
  })

  it('云币充值套餐表一致', () => {
    expect(COIN_PACKS).toEqual(plans.COIN_PACKS)
  })
})
