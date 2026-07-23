/** Account lifecycle template data and local previews. */

'use strict'

const { SES_TEMPLATE_CATALOG } = require('./template-catalog')

function formatChinaTime(value) {
  if (!Number.isFinite(value))
    return '待定'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;')
}

function renderVariables(source, data, html = false) {
  return Object.entries(data).reduce(
    (rendered, [key, value]) => rendered.replaceAll(
      `{{${key}}}`,
      html ? escapeHtml(value) : String(value),
    ),
    source,
  )
}

function templateDataFor(job) {
  switch (job.type) {
    case 'deletion_requested':
    case 'deletion_reminder_7d':
    case 'deletion_reminder_1d':
      return { deadline: formatChinaTime(job.deletionScheduledAt) }
    case 'deletion_completed':
    case 'deletion_delayed':
      return {}
    case 'deletion_cleanup_ops':
      return {
        caseRef: job.metadata?.caseRef || 'unknown',
        failureCount: String(Number(job.metadata?.failureCount) || 0),
        errorCode: job.metadata?.errorCode || 'cleanup_failed',
      }
    default:
      throw new Error(`未知账号生命周期邮件类型: ${job.type}`)
  }
}

function renderLifecycleEmail(job) {
  const definition = SES_TEMPLATE_CATALOG[job?.type]
  if (!definition)
    throw new Error(`未知账号生命周期邮件类型: ${job?.type}`)
  const templateData = templateDataFor(job)
  return {
    subject: definition.subject,
    templateData,
    text: renderVariables(definition.text, templateData),
    html: renderVariables(definition.html, templateData, true),
  }
}

module.exports = {
  escapeHtml,
  formatChinaTime,
  renderLifecycleEmail,
  renderVariables,
  templateDataFor,
}
