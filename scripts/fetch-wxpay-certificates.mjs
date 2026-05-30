#!/usr/bin/env node
/**
 * 拉取微信支付平台证书并解密，输出 wxpay-notify 所需的 WX_PLATFORM_CERTIFICATES JSON。
 *
 * 用法：
 *   WX_MCH_ID=xxx WX_SERIAL_NO=xxx WX_APIV3_KEY=xxx \
 *   WX_PRIVATE_KEY="$(cat apiclient_key.pem)" \
 *   node scripts/fetch-wxpay-certificates.mjs
 *
 * 也可以把 WX_PRIVATE_KEY 中的换行换成 \n 直接传字符串。
 *
 * 输出：
 *   - stdout 打印 JSON（key=序列号，value=PEM 公钥），可直接粘贴到 wxpay-notify 的环境变量
 *   - stderr 打印每张证书的概要（序列号、有效期）
 */

import { createRequire } from 'node:module'
import process from 'node:process'

const require = createRequire(import.meta.url)
const { decryptResource } = require('../functions/wxpay-order/lib/crypto.js')
const { wxpayRequest } = require('../functions/wxpay-order/lib/wxpay-client.js')

const { WX_MCH_ID, WX_SERIAL_NO, WX_PRIVATE_KEY, WX_APIV3_KEY } = process.env

const missing = ['WX_MCH_ID', 'WX_SERIAL_NO', 'WX_PRIVATE_KEY', 'WX_APIV3_KEY']
  .filter(k => !process.env[k])
if (missing.length) {
  console.error(`缺少环境变量: ${missing.join(', ')}`)
  process.exit(1)
}

const client = {
  mchId: WX_MCH_ID,
  serialNo: WX_SERIAL_NO,
  privateKey: WX_PRIVATE_KEY,
}

console.error('调用 GET /v3/certificates ...')
const res = await wxpayRequest(client, { method: 'GET', urlPath: '/v3/certificates' })

if (!Array.isArray(res?.data)) {
  console.error('返回结构异常:', JSON.stringify(res))
  process.exit(2)
}

const out = {}
for (const cert of res.data) {
  const { serial_no, effective_time, expire_time, encrypt_certificate } = cert
  if (!encrypt_certificate) {
    console.error(`证书 ${serial_no} 没有 encrypt_certificate`)
    continue
  }
  let pem
  try {
    const decrypted = decryptResource({
      resource: {
        ciphertext: encrypt_certificate.ciphertext,
        nonce: encrypt_certificate.nonce,
        associated_data: encrypt_certificate.associated_data,
      },
      apiV3Key: WX_APIV3_KEY,
    })
    // decryptResource 假定明文是 JSON，但证书明文是 PEM 字符串，需要用更原始的解密
    // 这里 decrypted 会抛错（PEM 不是合法 JSON），改用裸 decrypt
    pem = decrypted
  }
  catch {
    // PEM 不是合法 JSON，落到这里：直接拿 raw 解密结果
    pem = await decryptRawPem(encrypt_certificate, WX_APIV3_KEY)
  }
  console.error(`✓ ${serial_no}  有效期 ${effective_time} → ${expire_time}`)
  out[serial_no] = pem
}

if (Object.keys(out).length === 0) {
  console.error('没有可用证书')
  process.exit(3)
}

console.error('\n请把下面的 JSON 配置到 wxpay-notify 的 WX_PLATFORM_CERTIFICATES 环境变量：\n')
process.stdout.write(JSON.stringify(out))
process.stdout.write('\n')

// ---- 工具：当解密结果不是 JSON 时退化为直接解密返回字符串 ----
async function decryptRawPem(enc, apiV3Key) {
  const { Buffer } = await import('node:buffer')
  const crypto = await import('node:crypto')
  const ciphertextBuf = Buffer.from(enc.ciphertext, 'base64')
  const authTag = ciphertextBuf.slice(-16)
  const data = ciphertextBuf.slice(0, -16)
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    Buffer.from(apiV3Key),
    Buffer.from(enc.nonce),
  )
  decipher.setAuthTag(authTag)
  decipher.setAAD(Buffer.from(enc.associated_data || ''))
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}
