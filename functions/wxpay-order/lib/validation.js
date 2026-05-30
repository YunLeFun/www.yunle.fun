/**
 * 入参与回调内容校验。
 *
 * 校验"硬性、可由代码判定"的规则（类型、必填、范围），并在违反时抛错。
 * 业务语义校验（如金额是否匹配订单）放在 orders.js / 业务层。
 *
 * SYNCED FILE: 修改此文件后，请执行 `pnpm sync:wxpay-lib`。
 */

'use strict'

const { PLAN_PRICES } = require('./plans')

const PAY_TYPES = new Set(['native', 'jsapi', 'h5'])
const BILLING_CYCLES = new Set(['month', 'year'])
const RE_OUT_TRADE_NO = /^\w{6,32}$/

/**
 * 校验创建订单入参
 * @param {object} input
 * @returns {{ planId: string, billingCycle: string, payType: string, wxOpenid?: string }}
 */
function assertCreateOrderInput(input) {
  if (!input || typeof input !== 'object')
    throw new Error('参数必须为对象')
  const { planId, billingCycle, payType, wxOpenid } = input
  if (!planId || !PLAN_PRICES[planId])
    throw new Error(`无效套餐: ${planId}`)
  if (!billingCycle || !BILLING_CYCLES.has(billingCycle))
    throw new Error(`无效计费周期: ${billingCycle}`)
  if (!payType || !PAY_TYPES.has(payType))
    throw new Error(`不支持的支付方式: ${payType}`)
  if (payType === 'jsapi' && wxOpenid && typeof wxOpenid !== 'string')
    throw new Error('wxOpenid 必须为字符串')
  return { planId, billingCycle, payType, wxOpenid }
}

/**
 * 校验测试下单金额
 * @param {unknown} amount
 * @returns {number} 1~10000 分（不允许大额测试）
 */
function assertTestAmount(amount) {
  const n = Math.round(Number(amount))
  if (!Number.isFinite(n) || n < 1 || n > 10000)
    throw new Error('测试金额必须为 1~10000 分')
  return n
}

/**
 * 校验 outTradeNo 字符串
 * @param {unknown} outTradeNo
 * @returns {string}
 */
function assertOutTradeNo(outTradeNo) {
  if (typeof outTradeNo !== 'string' || !RE_OUT_TRADE_NO.test(outTradeNo))
    throw new Error('参数 outTradeNo 无效')
  return outTradeNo
}

/**
 * 比对回调解密内容是否与本地订单匹配
 *
 * @param {object} input
 * @param {object} input.resource 微信支付解密后的 resource
 * @param {object} input.order 本地数据库订单
 * @param {string} input.expectedAppid 当前商户配置的 appid
 * @param {string} input.expectedMchid 当前商户配置的 mchid
 * @returns {void}
 * @throws 如果任意字段不匹配
 */
function assertResourceMatchesOrder({ resource, order, expectedAppid, expectedMchid }) {
  if (!resource || !order)
    throw new Error('resource/order 缺失')
  if (resource.appid !== expectedAppid)
    throw new Error(`回调 appid 不匹配：${resource.appid} !== ${expectedAppid}`)
  if (resource.mchid !== expectedMchid)
    throw new Error(`回调 mchid 不匹配：${resource.mchid} !== ${expectedMchid}`)
  if (resource.out_trade_no !== order.outTradeNo)
    throw new Error(`回调 out_trade_no 不匹配本地订单`)
  const callbackAmount = resource?.amount?.total
  if (typeof callbackAmount !== 'number' || callbackAmount !== order.amount)
    throw new Error(`回调金额不匹配：${callbackAmount} !== ${order.amount}`)
}

module.exports = {
  PAY_TYPES,
  BILLING_CYCLES,
  assertCreateOrderInput,
  assertTestAmount,
  assertOutTradeNo,
  assertResourceMatchesOrder,
}
