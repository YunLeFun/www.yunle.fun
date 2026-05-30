/**
 * 云函数 wxpay-notify
 *
 * 接收微信支付 V3 异步回调，验签解密 → 校验金额/商户 → conditional update 标记订单已支付 → 开通会员。
 * 业务逻辑全部封装在 lib/notify-handler.js，本入口只负责装配运行时依赖。
 */

'use strict'

const process = require('node:process')
const cloudbase = require('@cloudbase/node-sdk')

const { handleNotify } = require('./lib/notify-handler')
const { parsePlatformCertificates } = require('./lib/signature')

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
const db = app.database()

// 启动时一次性解析证书配置（云函数实例存活期间复用）
const PLATFORM_CERTIFICATES = parsePlatformCertificates(process.env.WX_PLATFORM_CERTIFICATES)

function loadConfig() {
  const cfg = {
    apiV3Key: process.env.WX_APIV3_KEY,
    expectedAppid: process.env.WX_APPID,
    expectedMchid: process.env.WX_MCH_ID,
    toleranceSeconds: Number(process.env.WX_TIME_TOLERANCE || '300'),
    certificates: PLATFORM_CERTIFICATES,
  }
  const missing = []
  if (!cfg.apiV3Key)
    missing.push('WX_APIV3_KEY')
  if (!cfg.expectedAppid)
    missing.push('WX_APPID')
  if (!cfg.expectedMchid)
    missing.push('WX_MCH_ID')
  if (Object.keys(cfg.certificates).length === 0)
    missing.push('WX_PLATFORM_CERTIFICATES')
  if (missing.length > 0)
    throw new Error(`wxpay-notify 配置缺失: ${missing.join(', ')}`)
  return cfg
}

exports.main = async (event) => {
  let config
  try {
    config = loadConfig()
  }
  catch (err) {
    console.error('[wxpay-notify] 启动配置错误:', err.message)
    return {
      isBase64Encoded: false,
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'FAIL', message: '服务未配置' }),
    }
  }

  if (event?.httpMethod && event.httpMethod !== 'POST') {
    return {
      isBase64Encoded: false,
      statusCode: 405,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'FAIL', message: 'Method Not Allowed' }),
    }
  }

  return handleNotify({ event, db, config })
}
