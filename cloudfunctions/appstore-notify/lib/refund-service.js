/**
 * 微信会员退款编排：支付查单 -> 申请退款 / 查询退款 -> 推进本地退款状态机。
 *
 * SYNCED FILE: 修改此文件后，请执行 `pnpm sync:wxpay-lib`。
 */

'use strict'

const {
  applyWechatRefundResult,
  getMembershipRefund,
  markRefundRequestAttempt,
  markRefundRequestFailed,
  prepareMembershipRefund,
} = require('./refunds')
const {
  queryRefundByOutRefundNo,
  queryTransactionByOutTradeNo,
  requestRefund,
} = require('./wxpay-client')

function createWechatClient(config, overrides = {}) {
  return {
    mchId: config.mchId,
    serialNo: config.serialNo,
    privateKey: config.privateKey,
    ...overrides,
  }
}

function assertTransactionMatchesRefundOrder(transaction, order, config) {
  if (!transaction || transaction.trade_state !== 'SUCCESS')
    throw new Error(`微信支付订单不是可退款的成功状态: ${transaction?.trade_state || 'unknown'}`)
  if (
    transaction.appid !== config.appId
    || transaction.mchid !== config.mchId
    || transaction.out_trade_no !== order.outTradeNo
    || transaction.amount?.total !== order.amount
  ) {
    throw new Error('微信支付订单与本地订单不匹配')
  }
}

function normalizeWechatRefund(refund) {
  if (!refund || typeof refund !== 'object')
    throw new Error('微信退款接口未返回有效退款单')
  return {
    outTradeNo: refund.out_trade_no,
    outRefundNo: refund.out_refund_no,
    refundId: refund.refund_id,
    status: refund.status || refund.refund_status,
    successTime: refund.success_time,
    refundAmount: refund.amount?.refund,
    totalAmount: refund.amount?.total,
  }
}

async function requestMembershipRefundForAdmin(db, input, dependencies = {}) {
  const now = Number.isFinite(input?.now) ? input.now : Date.now()
  const prepared = await prepareMembershipRefund(db, { ...input, now })
  if (prepared.refund.status === 'SUCCESS')
    return prepared.result
  if (['PROCESSING', 'ABNORMAL', 'CLOSED'].includes(prepared.refund.status))
    return prepared.result

  const config = input.config
  const client = createWechatClient(config, dependencies.client)
  const queryTransaction = dependencies.queryTransaction || queryTransactionByOutTradeNo
  const submitRefund = dependencies.requestRefund || requestRefund

  let channelAccepted = false
  try {
    // 新退款在触发资金动作前向微信确认原交易，重试则依赖稳定 outRefundNo 的渠道幂等。
    if (!prepared.deduped) {
      const transaction = await queryTransaction(
        client,
        { outTradeNo: prepared.order.outTradeNo, mchId: config.mchId },
      )
      assertTransactionMatchesRefundOrder(transaction, prepared.order, config)
    }

    await markRefundRequestAttempt(db, prepared.order.outTradeNo, now)
    const response = await submitRefund(client, {
      out_trade_no: prepared.order.outTradeNo,
      out_refund_no: prepared.refund.outRefundNo,
      reason: prepared.refund.reason,
      notify_url: config.refundNotifyUrl,
      amount: {
        refund: prepared.order.amount,
        total: prepared.order.amount,
        currency: 'CNY',
      },
    })
    // 接口已返回即表示外部资金动作已被微信接收；后续本地校验/落库失败不能降级为申请失败。
    channelAccepted = true
    const channel = normalizeWechatRefund(response)
    if (channel.outTradeNo !== prepared.order.outTradeNo)
      throw new Error('微信退款响应的商户订单号不匹配')
    if (channel.outRefundNo !== prepared.refund.outRefundNo)
      throw new Error('微信退款响应的商户退款单号不匹配')

    return await applyWechatRefundResult(db, {
      ...channel,
      source: 'wechat-request',
      now,
    })
  }
  catch (error) {
    // 微信已经返回退款单后，本地推进失败不能把退款降级成“申请失败”；
    // 渠道回调或主动查单会继续用同一 outRefundNo 补偿。
    if (!channelAccepted) {
      await markRefundRequestFailed(db, {
        outTradeNo: prepared.order.outTradeNo,
        error: error?.message || String(error),
        now,
      })
    }
    throw error
  }
}

async function queryMembershipRefundForAdmin(db, input, dependencies = {}) {
  const now = Number.isFinite(input?.now) ? input.now : Date.now()
  const current = await getMembershipRefund(db, input?.outTradeNo)
  if (!current.outRefundNo)
    throw new Error('该订单尚未发起退款')

  const config = input.config
  const client = createWechatClient(config, dependencies.client)
  const queryRefund = dependencies.queryRefund || queryRefundByOutRefundNo
  const response = await queryRefund(client, current.outRefundNo)
  const channel = normalizeWechatRefund(response)
  if (channel.outTradeNo !== current.outTradeNo)
    throw new Error('微信退款查询结果的商户订单号不匹配')
  if (channel.outRefundNo !== current.outRefundNo)
    throw new Error('微信退款查询结果的商户退款单号不匹配')

  return applyWechatRefundResult(db, {
    ...channel,
    source: 'admin-query',
    now,
  })
}

module.exports = {
  assertTransactionMatchesRefundOrder,
  createWechatClient,
  normalizeWechatRefund,
  queryMembershipRefundForAdmin,
  requestMembershipRefundForAdmin,
}
