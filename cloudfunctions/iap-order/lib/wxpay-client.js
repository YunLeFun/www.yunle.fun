/**
 * 微信支付 V3 HTTP 客户端（依赖注入式）。
 *
 * 把 `fetch` 抽成参数，便于在测试中 mock，不会真正调用微信接口。
 *
 * SYNCED FILE: 修改此文件后，请执行 `pnpm sync:wxpay-lib`。
 */

'use strict'

const { generateNonceStr } = require('./crypto')
const { buildAuthorizationHeader } = require('./signature')

const WXPAY_HOST = 'https://api.mch.weixin.qq.com'

/**
 * 调用一次微信支付 V3 API
 *
 * @param {object} client
 * @param {string} client.mchId
 * @param {string} client.serialNo
 * @param {string} client.privateKey
 * @param {typeof fetch} [client.fetch]
 * @param {() => number} [client.nowSeconds]
 * @param {() => string} [client.nonceStr]
 *
 * @param {object} req
 * @param {'GET'|'POST'} req.method
 * @param {string} req.urlPath  例如 /v3/pay/transactions/native
 * @param {object} [req.body]
 * @returns {Promise<object>} 微信返回的 JSON
 */
async function wxpayRequest(client, { method, urlPath, body }) {
  const httpFetch = client.fetch ?? fetch
  const nowSecondsFn = client.nowSeconds ?? (() => Math.floor(Date.now() / 1000))
  const nonceFn = client.nonceStr ?? (() => generateNonceStr())
  const bodyStr = body ? JSON.stringify(body) : ''
  const timestamp = String(nowSecondsFn())
  const nonceStr = nonceFn()
  const authorization = buildAuthorizationHeader({
    method,
    urlPath,
    body: bodyStr,
    mchId: client.mchId,
    serialNo: client.serialNo,
    privateKey: client.privateKey,
    timestamp,
    nonceStr,
  })
  const response = await httpFetch(`${WXPAY_HOST}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      // 微信支付 V3 拒绝默认的 `Accept-Language: *`，必须显式声明
      'Accept-Language': 'zh-CN',
      'Authorization': authorization,
      'User-Agent': 'yunlefun-wxpay/1.0',
    },
    body: bodyStr || undefined,
  })
  // 微信对于成功的 GET 返回 200 + JSON
  const text = await response.text()
  let data = {}
  if (text) {
    try {
      data = JSON.parse(text)
    }
    catch {
      data = { _raw: text }
    }
  }
  if (!response.ok) {
    const error = new Error(data?.message || `微信支付接口调用失败: HTTP ${response.status}`)
    error.statusCode = response.status
    error.code = data?.code
    error.detail = data
    throw error
  }
  return data
}

/**
 * 查询微信支付订单状态
 *
 * @param {object} client
 * @param {object} input
 * @param {string} input.outTradeNo
 * @param {string} input.mchId
 * @returns {Promise<object>} 微信返回的 transaction 对象
 */
async function queryTransactionByOutTradeNo(client, { outTradeNo, mchId }) {
  return wxpayRequest(client, {
    method: 'GET',
    urlPath: `/v3/pay/transactions/out-trade-no/${encodeURIComponent(outTradeNo)}?mchid=${encodeURIComponent(mchId)}`,
  })
}

/**
 * 发起微信支付全额或部分退款。
 *
 * @param {object} client
 * @param {object} input 微信退款 API 请求体
 * @returns {Promise<object>} 微信退款单
 */
async function requestRefund(client, input) {
  return wxpayRequest(client, {
    method: 'POST',
    urlPath: '/v3/refund/domestic/refunds',
    body: input,
  })
}

/** 按稳定商户退款单号查询微信退款结果。 */
async function queryRefundByOutRefundNo(client, outRefundNo) {
  return wxpayRequest(client, {
    method: 'GET',
    urlPath: `/v3/refund/domestic/refunds/${encodeURIComponent(outRefundNo)}`,
  })
}

module.exports = {
  WXPAY_HOST,
  queryRefundByOutRefundNo,
  queryTransactionByOutTradeNo,
  requestRefund,
  wxpayRequest,
}
