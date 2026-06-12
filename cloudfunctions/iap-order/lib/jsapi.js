/**
 * JSAPI 支付参数生成（纯函数）。
 *
 * SYNCED FILE: 修改此文件后，请执行 `pnpm sync:wxpay-lib`。
 */

'use strict'

const { buildJsapiSigningString, signWithPrivateKey } = require('./signature')

/**
 * 生成 WeixinJSBridge.invoke('getBrandWCPayRequest') 所需的支付参数
 *
 * @param {object} input
 * @param {string} input.appId
 * @param {string} input.prepayId
 * @param {string} input.privateKey 商户 API 私钥
 * @param {string} input.timestamp 秒级时间戳字符串
 * @param {string} input.nonceStr 随机串
 * @returns {{ appId: string, timeStamp: string, nonceStr: string, package: string, signType: 'RSA', paySign: string }}
 */
function generateJsapiPayParams({ appId, prepayId, privateKey, timestamp, nonceStr }) {
  if (!appId || !prepayId || !privateKey || !timestamp || !nonceStr)
    throw new Error('generateJsapiPayParams: 缺少必要参数')
  const packageStr = `prepay_id=${prepayId}`
  const content = buildJsapiSigningString({ appId, timestamp, nonce: nonceStr, packageStr })
  const paySign = signWithPrivateKey(content, privateKey)
  return {
    appId,
    timeStamp: timestamp,
    nonceStr,
    package: packageStr,
    signType: 'RSA',
    paySign,
  }
}

module.exports = {
  generateJsapiPayParams,
}
