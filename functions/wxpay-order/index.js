const crypto = require('node:crypto')
const process = require('node:process')
const cloudbase = require('@cloudbase/node-sdk')

const RE_ESCAPE_NEWLINE = /\\n/g
const RE_PEM_BEGIN = /-----BEGIN (?:RSA )?PRIVATE KEY-----/
const RE_PEM_END = /-----END (?:RSA )?PRIVATE KEY-----/
const RE_WHITESPACE = /\s+/g

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
const db = app.database()
const ORDERS_COLLECTION = 'orders'

// 套餐价格表（单位：分），与前端保持一致
const PLAN_PRICES = {
  basic: { month: 990, year: 9990 },
}

// ============ 微信支付 V3 工具函数 ============

/**
 * 修复私钥 PEM 格式
 * 兼容：\n 转义、空格分隔、无分隔等多种控制台粘贴格式
 */
function normalizePrivateKey(raw) {
  // 1. 先处理 \n 字面量转义
  let key = raw.replace(RE_ESCAPE_NEWLINE, '\n')
  // 2. 去掉首尾空白
  key = key.trim()
  // 3. 如果已经是正确的多行 PEM，直接返回
  if (key.includes('\n'))
    return key
  // 4. 单行情况：提取纯 base64 内容，按 64 字符折行
  const base64 = key
    .replace(RE_PEM_BEGIN, '')
    .replace(RE_PEM_END, '')
    .replace(RE_WHITESPACE, '')
  const lines = []
  for (let i = 0; i < base64.length; i += 64) {
    lines.push(base64.slice(i, i + 64))
  }
  return `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----`
}

/**
 * 生成随机字符串
 */
function generateNonceStr(length = 32) {
  return crypto.randomBytes(length).toString('hex').slice(0, length)
}

/**
 * 生成商户订单号
 */
function generateOutTradeNo() {
  const timestamp = Date.now().toString()
  const random = crypto.randomBytes(4).toString('hex')
  return `YLF${timestamp}${random}`
}

/**
 * V3 签名 - 生成 Authorization Header
 */
function generateAuthHeader(method, url, body = '') {
  const mchId = process.env.WX_MCH_ID
  const serialNo = process.env.WX_SERIAL_NO
  const privateKey = process.env.WX_PRIVATE_KEY

  if (!mchId || !serialNo || !privateKey) {
    throw new Error('微信支付商户配置缺失，请配置环境变量')
  }

  const timestamp = Math.floor(Date.now() / 1000).toString()
  const nonceStr = generateNonceStr()
  const message = `${method}\n${url}\n${timestamp}\n${nonceStr}\n${body}\n`

  const sign = crypto
    .createSign('RSA-SHA256')
    .update(message)
    .sign(normalizePrivateKey(privateKey), 'base64')

  return `WECHATPAY2-SHA256-RSA2048 mchid="${mchId}",nonce_str="${nonceStr}",signature="${sign}",timestamp="${timestamp}",serial_no="${serialNo}"`
}

/**
 * 调用微信支付 V3 API
 */
async function wxpayRequest(method, urlPath, body) {
  const bodyStr = body ? JSON.stringify(body) : ''
  const authorization = generateAuthHeader(method, urlPath, bodyStr)

  const response = await fetch(`https://api.mch.weixin.qq.com${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': authorization,
    },
    body: bodyStr || undefined,
  })

  const data = await response.json()
  if (!response.ok) {
    console.error('微信支付 API 错误:', JSON.stringify(data))
    throw new Error(data.message || '微信支付接口调用失败')
  }
  return data
}

/**
 * 生成 JSAPI 支付签名参数
 */
function generateJsapiPayParams(prepayId) {
  const appId = process.env.WX_APPID
  const privateKey = process.env.WX_PRIVATE_KEY
  if (!appId || !privateKey) {
    throw new Error('微信支付 APPID 或私钥配置缺失')
  }

  const timeStamp = Math.floor(Date.now() / 1000).toString()
  const nonceStr = generateNonceStr()
  const packageStr = `prepay_id=${prepayId}`
  const message = `${appId}\n${timeStamp}\n${nonceStr}\n${packageStr}\n`

  const paySign = crypto
    .createSign('RSA-SHA256')
    .update(message)
    .sign(normalizePrivateKey(privateKey), 'base64')

  return {
    appId,
    timeStamp,
    nonceStr,
    package: packageStr,
    signType: 'RSA',
    paySign,
  }
}

// ============ 业务逻辑 ============

/**
 * 创建测试订单（自定义金额）
 */
async function handleCreateTestOrder(event, context) {
  const { amount: customAmount, payType, description: customDesc, wxOpenid } = event
  const { OPENID: openid } = context.env || {}

  if (!customAmount || !payType) {
    throw new Error('参数缺失: amount, payType 必填')
  }
  const amount = Math.round(Number(customAmount))
  if (!Number.isFinite(amount) || amount < 1) {
    throw new Error('金额无效，最小 1 分')
  }

  const outTradeNo = generateOutTradeNo()
  const notifyUrl = process.env.WX_NOTIFY_URL
  const appId = process.env.WX_APPID
  const mchId = process.env.WX_MCH_ID

  if (!notifyUrl || !appId || !mchId) {
    throw new Error('微信支付配置缺失，请联系管理员')
  }

  const orderParams = {
    appid: appId,
    mchid: mchId,
    description: customDesc || `云乐坊测试支付 ${(amount / 100).toFixed(2)} 元`,
    out_trade_no: outTradeNo,
    notify_url: notifyUrl,
    amount: { total: amount, currency: 'CNY' },
  }

  let wxResult, apiPath

  if (payType === 'native') {
    apiPath = '/v3/pay/transactions/native'
    wxResult = await wxpayRequest('POST', apiPath, orderParams)
  }
  else if (payType === 'jsapi') {
    apiPath = '/v3/pay/transactions/jsapi'
    const payer = wxOpenid || openid
    if (!payer)
      throw new Error('JSAPI 支付需要微信 openid')
    wxResult = await wxpayRequest('POST', apiPath, { ...orderParams, payer: { openid: payer } })
  }
  else if (payType === 'h5') {
    apiPath = '/v3/pay/transactions/h5'
    wxResult = await wxpayRequest('POST', apiPath, {
      ...orderParams,
      scene_info: { payer_client_ip: event.clientIp || '127.0.0.1', h5_info: { type: 'Wap' } },
    })
  }
  else {
    throw new Error(`不支持的支付方式: ${payType}`)
  }

  const now = Date.now()
  await db.collection(ORDERS_COLLECTION).add({
    userId: openid || '',
    planId: 'test',
    billingCycle: 'once',
    amount,
    payType,
    status: 'pending',
    outTradeNo,
    codeUrl: wxResult.code_url || '',
    h5Url: wxResult.h5_url || '',
    prepayId: wxResult.prepay_id || '',
    createdAt: now,
    updatedAt: now,
  })

  const result = { outTradeNo, payType }
  if (payType === 'native')
    result.codeUrl = wxResult.code_url
  else if (payType === 'h5')
    result.h5Url = wxResult.h5_url
  else if (payType === 'jsapi')
    result.jsapiParams = generateJsapiPayParams(wxResult.prepay_id)

  return result
}

/**
 * 创建订单
 */
async function handleCreateOrder(event, context) {
  const { planId, billingCycle, payType, wxOpenid } = event
  const { OPENID: openid } = context.env || {}

  // 参数校验
  if (!planId || !billingCycle || !payType) {
    throw new Error('参数缺失: planId, billingCycle, payType 必填')
  }
  if (!PLAN_PRICES[planId] || !PLAN_PRICES[planId][billingCycle]) {
    throw new Error('无效的套餐或计费周期')
  }

  const amount = PLAN_PRICES[planId][billingCycle]
  const outTradeNo = generateOutTradeNo()
  const notifyUrl = process.env.WX_NOTIFY_URL
  const appId = process.env.WX_APPID
  const mchId = process.env.WX_MCH_ID

  if (!notifyUrl || !appId || !mchId) {
    throw new Error('微信支付配置缺失，请联系管理员')
  }

  // 公共下单参数
  const orderParams = {
    appid: appId,
    mchid: mchId,
    description: `云乐坊 ${planId} 套餐 - ${billingCycle === 'month' ? '月付' : '年付'}`,
    out_trade_no: outTradeNo,
    notify_url: notifyUrl,
    amount: {
      total: amount,
      currency: 'CNY',
    },
  }

  let wxResult
  let apiPath

  // 根据支付方式调用不同 API
  if (payType === 'native') {
    apiPath = '/v3/pay/transactions/native'
    wxResult = await wxpayRequest('POST', apiPath, orderParams)
  }
  else if (payType === 'jsapi') {
    apiPath = '/v3/pay/transactions/jsapi'
    const payer = wxOpenid || openid
    if (!payer) {
      throw new Error('JSAPI 支付需要微信 openid')
    }
    wxResult = await wxpayRequest('POST', apiPath, {
      ...orderParams,
      payer: { openid: payer },
    })
  }
  else if (payType === 'h5') {
    apiPath = '/v3/pay/transactions/h5'
    wxResult = await wxpayRequest('POST', apiPath, {
      ...orderParams,
      scene_info: {
        payer_client_ip: event.clientIp || '127.0.0.1',
        h5_info: { type: 'Wap' },
      },
    })
  }
  else {
    throw new Error(`不支持的支付方式: ${payType}`)
  }

  // 在数据库中创建订单记录
  const now = Date.now()
  const orderRecord = {
    userId: openid || '',
    planId,
    billingCycle,
    amount,
    payType,
    status: 'pending',
    outTradeNo,
    codeUrl: wxResult.code_url || '',
    h5Url: wxResult.h5_url || '',
    prepayId: wxResult.prepay_id || '',
    createdAt: now,
    updatedAt: now,
  }

  await db.collection(ORDERS_COLLECTION).add(orderRecord)

  // 构造返回结果
  const result = {
    orderId: orderRecord._id,
    outTradeNo,
    payType,
  }

  if (payType === 'native') {
    result.codeUrl = wxResult.code_url
  }
  else if (payType === 'h5') {
    result.h5Url = wxResult.h5_url
  }
  else if (payType === 'jsapi') {
    result.jsapiParams = generateJsapiPayParams(wxResult.prepay_id)
  }

  return result
}

/**
 * 查询订单状态
 */
async function handleQueryOrder(event) {
  const { outTradeNo } = event
  if (!outTradeNo) {
    throw new Error('参数缺失: outTradeNo 必填')
  }

  const { data } = await db
    .collection(ORDERS_COLLECTION)
    .where({ outTradeNo })
    .limit(1)
    .get()

  if (!data || data.length === 0) {
    throw new Error('订单不存在')
  }

  const order = data[0]
  return {
    status: order.status,
    transactionId: order.transactionId || null,
    paidAt: order.paidAt || null,
  }
}

// ============ 云函数入口 ============

exports.main = async (event, context) => {
  const { action } = event

  switch (action) {
    case 'createOrder':
      return handleCreateOrder(event, context)
    case 'createTestOrder':
      return handleCreateTestOrder(event, context)
    case 'queryOrder':
      return handleQueryOrder(event)
    default:
      throw new Error(`未知 action: ${action}`)
  }
}
