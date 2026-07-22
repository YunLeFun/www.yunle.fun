/** 账号生命周期事务邮件模板。 */

'use strict'

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

function wrapHtml(title, paragraphs, action) {
  const body = paragraphs.map(text => `<p style="margin:0 0 12px;line-height:1.7;color:#334155">${text}</p>`).join('')
  const button = action
    ? `<p style="margin:24px 0"><a href="${action.href}" style="display:inline-block;padding:10px 18px;border-radius:10px;background:#2563eb;color:#fff;text-decoration:none">${action.label}</a></p>`
    : ''
  return `<!doctype html><html lang="zh-CN"><body style="margin:0;background:#f8fafc;font-family:system-ui,-apple-system,sans-serif"><main style="max-width:600px;margin:0 auto;padding:32px 20px"><section style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:28px"><h1 style="margin:0 0 20px;font-size:22px;color:#0f172a">${title}</h1>${body}${button}<p style="margin:24px 0 0;font-size:12px;color:#64748b">云乐坊账号安全通知 · 请勿回复或转发敏感信息</p></section></main></body></html>`
}

function make(subject, lines, action) {
  return {
    subject,
    text: `${lines.join('\n\n')}\n\n云乐坊账号安全通知`,
    html: wrapHtml(subject, lines, action),
  }
}

function renderLifecycleEmail(job) {
  const deadline = formatChinaTime(job.deletionScheduledAt)
  switch (job.type) {
    case 'deletion_requested':
      return make('账号注销申请已提交', [
        '你的云乐坊账号已进入 30 天注销冷静期，账号功能现已冻结。',
        `可恢复截止时间：${deadline}，中国标准时间（UTC+8）。`,
        '登录不会自动撤销注销；如需继续使用，请在截止时间前进入账号状态页并明确点击“恢复账号”。',
      ], { label: '恢复账号', href: 'https://www.yunle.fun/account-status' })
    case 'deletion_reminder_7d':
      return make('账号将在 7 天后完成注销', [
        `账号预计于 ${deadline}（中国标准时间 UTC+8）进入不可撤销清理。`,
        '若你改变主意，请在截止时间前进入账号状态页明确恢复。',
      ], { label: '查看账号状态', href: 'https://www.yunle.fun/account-status' })
    case 'deletion_reminder_1d':
      return make('账号将在 1 天后完成注销', [
        `账号预计于 ${deadline}（中国标准时间 UTC+8）进入不可撤销清理。`,
        '这是最后一次提醒；截止后即使后台仍在清理也不能恢复。',
      ], { label: '查看账号状态', href: 'https://www.yunle.fun/account-status' })
    case 'deletion_completed':
      return make('账号注销已完成', [
        '你的云乐坊认证身份、公开资料和核心登录绑定已经完成清理。',
        '用户名、手机号、邮箱和第三方登录绑定现已释放；依法需要保留的交易记录仍受严格访问控制。',
      ])
    case 'deletion_delayed':
      return make('账号注销处理延迟', [
        '账号清理已超过 24 小时仍未完成，我们正在自动重试并已通知运维人员。',
        '账号保持不可登录，绑定将在全部步骤成功后统一释放；你无需重复提交申请。',
      ], { label: '联系客服', href: 'https://www.yunle.fun/docs/contact' })
    case 'deletion_cleanup_ops':
      return make('账号注销清理需要运维处理', [
        `案件引用：${job.metadata?.caseRef || 'unknown'}`,
        `失败次数：${Number(job.metadata?.failureCount) || 0}。请在内部日志中按案件引用排查，邮件不包含用户 PII 或错误堆栈。`,
      ])
    default:
      throw new Error(`未知账号生命周期邮件类型: ${job.type}`)
  }
}

module.exports = { formatChinaTime, renderLifecycleEmail }
