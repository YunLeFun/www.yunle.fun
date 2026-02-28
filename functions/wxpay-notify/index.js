const { Buffer } = require('node:buffer')
const crypto = require('node:crypto')
const process = require('node:process')
const cloudbase = require('@cloudbase/node-sdk')

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
const db = app.database()
const ORDERS_COLLECTION = 'orders'

/**
 * 验证微信支付 V3 回调签名
 */
function verifySignature(headers, _body) {
  const timestamp = headers['wechatpay-timestamp']
  const nonce = headers['wechatpay-nonce']
  const signature = headers['wechatpay-signature']
  const serial = headers['wechatpay-serial']

  if (!timestamp || !nonce || !signature || !serial) {
    console.error('缺少微信支付签名头')
    return false
  }

  // 注意：生产环境应使用微信支付平台证书验签
  // 此处为框架代码，需要配置平台证书后完善验签逻辑
  // 参考文档：https://pay.weixin.qq.com/docs/merchant/development/interface-rules/signature-verification.html
  console.warn('⚠️ 回调签名验证逻辑需配置平台证书后完善')
  return true
}

/**
 * AES-256-GCM 解密回调数据
 */
function decryptResource(resource) {
  const apiV3Key = process.env.WX_APIV3_KEY
  if (!apiV3Key) {
    throw new Error('缺少 WX_APIV3_KEY 环境变量')
  }

  const { ciphertext, nonce, associated_data } = resource
  const ciphertextBuffer = Buffer.from(ciphertext, 'base64')

  // 最后 16 字节是 auth tag
  const authTag = ciphertextBuffer.slice(-16)
  const data = ciphertextBuffer.slice(0, -16)

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    Buffer.from(apiV3Key),
    Buffer.from(nonce),
  )
  decipher.setAuthTag(authTag)
  decipher.setAAD(Buffer.from(associated_data || ''))

  const decrypted = Buffer.concat([
    decipher.update(data),
    decipher.final(),
  ])

  return JSON.parse(decrypted.toString('utf8'))
}

/**
 * 云函数入口 - 接收微信支付回调（HTTP Access 模式）
 */
exports.main = async (event) => {
  // HTTP Access 模式下，event 包含 httpMethod, headers, body 等
  const headers = {}
  // 统一 header key 为小写
  if (event.headers) {
    for (const [key, value] of Object.entries(event.headers)) {
      headers[key.toLowerCase()] = value
    }
  }

  const body = typeof event.body === 'string' ? event.body : JSON.stringify(event.body)

  // 验签
  if (!verifySignature(headers, body)) {
    return {
      isBase64Encoded: false,
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'FAIL', message: '签名验证失败' }),
    }
  }

  try {
    const notification = JSON.parse(body)

    // 检查事件类型
    if (notification.event_type !== 'TRANSACTION.SUCCESS') {
      console.warn('非支付成功事件，忽略:', notification.event_type)
      return {
        isBase64Encoded: false,
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'SUCCESS', message: '已接收' }),
      }
    }

    // 解密通知数据
    const resource = decryptResource(notification.resource)
    console.warn('支付通知解密结果:', JSON.stringify(resource))

    const { out_trade_no, transaction_id, trade_state } = resource

    if (trade_state !== 'SUCCESS') {
      console.warn('交易状态非成功:', trade_state)
      return {
        isBase64Encoded: false,
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'SUCCESS', message: '已接收' }),
      }
    }

    // 更新订单状态
    const { data } = await db
      .collection(ORDERS_COLLECTION)
      .where({ outTradeNo: out_trade_no })
      .limit(1)
      .get()

    if (data && data.length > 0) {
      const order = data[0]
      // 防止重复处理
      if (order.status === 'paid') {
        console.warn('订单已支付，跳过:', out_trade_no)
      }
      else {
        await db.collection(ORDERS_COLLECTION).doc(order._id).update({
          status: 'paid',
          transactionId: transaction_id,
          paidAt: Date.now(),
          updatedAt: Date.now(),
        })
        console.warn('订单状态已更新为 paid:', out_trade_no)
      }
    }
    else {
      console.error('未找到对应订单:', out_trade_no)
    }

    return {
      isBase64Encoded: false,
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'SUCCESS', message: '成功' }),
    }
  }
  catch (err) {
    console.error('处理支付回调异常:', err)
    return {
      isBase64Encoded: false,
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'FAIL', message: '处理失败' }),
    }
  }
}
