/** Cloudflare Email Sending REST client. */

'use strict'

class EmailDeliveryError extends Error {
  constructor(message, { status = 0, retryable = false } = {}) {
    super(message)
    this.name = 'EmailDeliveryError'
    this.status = status
    this.retryable = retryable
  }
}

function required(value, name) {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${name} 未配置`)
  return value.trim()
}

async function sendCloudflareEmail(fetchImpl, config, message) {
  const accountId = required(config?.accountId, 'CLOUDFLARE_EMAIL_ACCOUNT_ID')
  const apiToken = required(config?.apiToken, 'CLOUDFLARE_EMAIL_API_TOKEN')
  const fromAddress = required(config?.fromAddress, 'ACCOUNT_LIFECYCLE_FROM_EMAIL')
  const to = required(message?.to, '邮件收件地址')
  const subject = required(message?.subject, '邮件主题')
  const text = required(message?.text, '邮件纯文本正文')
  const html = required(message?.html, '邮件 HTML 正文')

  let response
  try {
    response = await fetchImpl(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/email/sending/send`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: { address: fromAddress, name: config.fromName || '云乐坊' },
          reply_to: config.replyTo || fromAddress,
          to,
          subject,
          text,
          html,
        }),
      },
    )
  }
  catch {
    throw new EmailDeliveryError('邮件服务网络请求失败', { retryable: true })
  }

  let payload = null
  try {
    payload = await response.json()
  }
  catch {}
  if (!response.ok || payload?.success === false) {
    const status = Number(response.status) || 0
    throw new EmailDeliveryError('邮件服务拒绝发送请求', {
      status,
      retryable: status === 429 || status >= 500,
    })
  }
  const result = payload?.result || {}
  return {
    ...result,
    id: result.message_id || result.id || null,
  }
}

module.exports = { EmailDeliveryError, sendCloudflareEmail }
