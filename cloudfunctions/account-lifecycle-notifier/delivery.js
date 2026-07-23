/** Tencent Cloud SES template delivery and status adapter. */

'use strict'

const RETRYABLE_ERROR_CODES = new Set([
  'InternalError',
  'LimitExceeded',
  'RequestLimitExceeded',
  'ResourceUnavailable',
  'ServiceUnavailable',
  'FailedOperation.FrequencyLimit',
  'FailedOperation.Temporary',
])

class EmailDeliveryError extends Error {
  constructor(message, {
    code = 'UnknownError',
    requestId = null,
    retryable = false,
  } = {}) {
    super(message)
    this.name = 'EmailDeliveryError'
    this.code = code
    this.requestId = requestId
    this.retryable = retryable
  }
}

function required(value, name) {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${name} 未配置`)
  return value.trim()
}

function requiredTemplateId(config, type) {
  const value = Number(config?.templateIds?.[type])
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`SES 模板 ${type} 未配置`)
  return value
}

function smtpMessageId(jobId, fromAddress) {
  const domain = fromAddress.split('@')[1]
  const safeId = required(jobId, '通知任务 ID').replace(/[^\w.-]/g, '')
  return `<${safeId}@${domain}>`
}

function isRetryableSesError(code) {
  if (RETRYABLE_ERROR_CODES.has(code))
    return true
  return /^InternalError(?:\.|$)/.test(code)
    || /^RequestLimitExceeded(?:\.|$)/.test(code)
    || /^ServiceUnavailable(?:\.|$)/.test(code)
}

async function sendTencentEmail(client, config, message) {
  if (!client || typeof client.SendEmail !== 'function')
    throw new Error('Tencent Cloud SES 客户端未配置')

  const fromAddress = required(config?.fromAddress, 'SES_FROM_EMAIL')
  const fromName = required(config?.fromName, 'SES_FROM_NAME')
  const replyTo = required(config?.replyTo, 'SES_REPLY_TO')
  const to = required(message?.to, '邮件收件地址')
  const subject = required(message?.subject, '邮件主题')
  const type = required(message?.type, '邮件模板类型')
  const templateId = requiredTemplateId(config, type)
  const id = required(message?.id, '通知任务 ID')

  try {
    const result = await client.SendEmail({
      Destination: [to],
      FromEmailAddress: `${fromName} <${fromAddress}>`,
      ReplyToAddresses: replyTo,
      Subject: subject,
      Template: {
        TemplateData: JSON.stringify(message?.templateData || {}),
        TemplateID: templateId,
      },
      TriggerType: 1,
      Unsubscribe: '0',
      SmtpMessageId: smtpMessageId(id, fromAddress),
    })
    if (typeof result?.MessageId !== 'string' || !result.MessageId) {
      throw new EmailDeliveryError('邮件服务未返回 MessageId', {
        code: 'MissingMessageId',
        requestId: result?.RequestId || null,
        retryable: true,
      })
    }
    return {
      id: result.MessageId,
      requestId: result?.RequestId || null,
    }
  }
  catch (error) {
    if (error instanceof EmailDeliveryError)
      throw error
    const code = typeof error?.code === 'string' && error.code
      ? error.code
      : 'UnknownError'
    throw new EmailDeliveryError('邮件服务拒绝发送请求', {
      code,
      requestId: typeof error?.requestId === 'string' ? error.requestId : null,
      retryable: isRetryableSesError(code),
    })
  }
}

function formatChinaDate(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value))
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function normalizeEmailStatus(row) {
  if (!row) {
    return {
      state: 'submitted',
      sendStatus: null,
      deliverStatus: null,
      complained: false,
      deliverTime: null,
    }
  }

  const sendStatus = Number.isFinite(row.SendStatus) ? row.SendStatus : null
  const deliverStatus = Number.isFinite(row.DeliverStatus) ? row.DeliverStatus : null
  const complained = row.UserComplained === true || row.UserComplainted === true
  let state = 'submitted'
  if (complained)
    state = 'complained'
  else if (sendStatus !== null && sendStatus !== 0)
    state = 'provider_failed'
  else if (deliverStatus === 1)
    state = 'delivered'
  else if (deliverStatus === 2)
    state = 'dropped'
  else if (deliverStatus === 3)
    state = 'bounced'
  else if (deliverStatus === 8)
    state = 'deferred'

  return {
    state,
    sendStatus,
    deliverStatus,
    complained,
    deliverTime: Number.isFinite(row.DeliverTime) && row.DeliverTime > 0
      ? row.DeliverTime * 1000
      : null,
  }
}

async function getTencentEmailStatus(client, { messageId, submittedAt }) {
  if (!client || typeof client.GetSendEmailStatus !== 'function')
    throw new Error('Tencent Cloud SES 状态客户端未配置')
  const result = await client.GetSendEmailStatus({
    Limit: 10,
    MessageId: required(messageId, 'SES MessageId'),
    Offset: 0,
    RequestDate: formatChinaDate(submittedAt),
  })
  const rows = Array.isArray(result?.EmailStatusList) ? result.EmailStatusList : []
  return normalizeEmailStatus(rows.find(row => row?.MessageId === messageId) || rows[0])
}

module.exports = {
  EmailDeliveryError,
  formatChinaDate,
  getTencentEmailStatus,
  isRetryableSesError,
  normalizeEmailStatus,
  sendTencentEmail,
}
