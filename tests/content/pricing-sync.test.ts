import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PLAN_PRICES } from '@yunlefun/types'
import { describe, expect, it } from 'vitest'

/**
 * content/ 下面向用户展示的会员价是「元」字符串（如 ¥10），与服务端真相源
 * PLAN_PRICES.basic（单位：分，经 @yunlefun/types 暴露）没有任何运行时关联，
 * 过去靠手改保持一致。本测试在两者金额漂移时让 CI 失败。
 *
 * 注：@yunlefun/types 与 cloudfunctions/wxpay-order/lib/plans.js 的一致性
 * 由 tests/wxpay/types-sync.test.ts 守护，故此处只需校验 content 一侧。
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** 面向用户展示会员价的内容文件 */
const CONTENT_FILES = [
  'content/2.pricing.yml', //                    驱动 /pricing 页的结构化定价
  'content/1.docs/1.getting-started/1.index.md', // 「会员方案」文档表格
]

/** PLAN_PRICES 分值 → 人读「元」字符串，并转义小数点供正则使用 */
function toYuanPattern(fen: number) {
  return String(fen / 100).replace(/\./g, '\\.')
}

describe('content 会员价与 PLAN_PRICES 同步', () => {
  for (const file of CONTENT_FILES) {
    const text = readFileSync(resolve(ROOT, file), 'utf8')
    it(`${file} 含与 PLAN_PRICES.basic 一致的月付 / 年付价`, () => {
      for (const fen of [PLAN_PRICES.basic.month, PLAN_PRICES.basic.year]) {
        // ¥ 后紧跟金额，且其后不接数字（否则 ¥10 会错误命中 ¥100）
        expect(text).toMatch(new RegExp(`¥${toYuanPattern(fen)}(?!\\d)`))
      }
    })
  }
})

describe('会员购买文案与非自动续订模式一致', () => {
  const content = readFileSync(resolve(ROOT, 'content/2.pricing.yml'), 'utf8')
  const page = readFileSync(resolve(ROOT, 'app/pages/pricing.vue'), 'utf8')

  it('明确单次购买且不会自动续费', () => {
    expect(content).toMatch(/不会自动续费/)
    expect(content).not.toMatch(/如何取消订阅/)
    expect(page).toMatch(/单次购买/)
    expect(page).toMatch(/立即购买/)
    expect(page).not.toMatch(/随时可取消|立即订阅/)
  })
})
