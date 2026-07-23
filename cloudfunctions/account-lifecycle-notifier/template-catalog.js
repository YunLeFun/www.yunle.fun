/** Versioned Tencent Cloud SES template sources and variable contracts. */

'use strict'

function htmlTemplate(title, paragraphs, action) {
  const body = paragraphs
    .map(text => `<p style="margin:0 0 12px;line-height:1.7;color:#334155">${text}</p>`)
    .join('')
  const button = action
    ? `<p style="margin:24px 0"><a href="${action.href}" style="display:inline-block;padding:10px 18px;border-radius:10px;background:#2563eb;color:#fff;text-decoration:none">${action.label}</a></p>`
    : ''
  return `<!doctype html><html lang="zh-CN"><body style="margin:0;background:#f8fafc;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"><main style="max-width:600px;margin:0 auto;padding:32px 20px"><section style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:28px"><h1 style="margin:0 0 20px;font-size:22px;color:#0f172a">${title}</h1>${body}${button}<p style="margin:24px 0 0;font-size:12px;color:#64748b">云乐坊账号安全通知 · 如需帮助，请直接回复本邮件</p></section></main></body></html>`
}

function textTemplate(lines) {
  return `${lines.join('\n\n')}\n\n云乐坊账号安全通知\n如需帮助，请直接回复本邮件。`
}

const SES_TEMPLATE_CATALOG = Object.freeze({
  deletion_requested: {
    version: 1,
    name: 'yunlefun-account-deletion-requested-v1',
    environmentVariable: 'SES_TEMPLATE_DELETION_REQUESTED',
    subject: '账号注销申请已提交',
    variables: ['deadline'],
    html: htmlTemplate('账号注销申请已提交', [
      '你的云乐坊账号已进入 30 天注销冷静期，账号功能现已冻结。',
      '可恢复截止时间：{{deadline}}，中国标准时间（UTC+8）。',
      '登录不会自动撤销注销，打开邮件也不会；如需继续使用，请在截止时间前登录账号状态页并明确确认恢复。',
    ], { label: '恢复账号', href: 'https://www.yunle.fun/account-status' }),
    text: textTemplate([
      '你的云乐坊账号已进入 30 天注销冷静期，账号功能现已冻结。',
      '可恢复截止时间：{{deadline}}，中国标准时间（UTC+8）。',
      '登录不会自动撤销注销，打开邮件也不会。如需继续使用，请在截止时间前访问：https://www.yunle.fun/account-status',
    ]),
  },
  deletion_reminder_7d: {
    version: 1,
    name: 'yunlefun-account-deletion-reminder-7d-v1',
    environmentVariable: 'SES_TEMPLATE_DELETION_REMINDER_7D',
    subject: '账号将在 7 天后完成注销',
    variables: ['deadline'],
    html: htmlTemplate('账号将在 7 天后完成注销', [
      '账号预计于 {{deadline}}（中国标准时间 UTC+8）进入不可撤销清理。',
      '若你改变主意，请在截止时间前登录账号状态页并明确确认恢复。',
    ], { label: '查看账号状态', href: 'https://www.yunle.fun/account-status' }),
    text: textTemplate([
      '账号预计于 {{deadline}}（中国标准时间 UTC+8）进入不可撤销清理。',
      '若你改变主意，请在截止时间前访问：https://www.yunle.fun/account-status',
    ]),
  },
  deletion_reminder_1d: {
    version: 1,
    name: 'yunlefun-account-deletion-reminder-1d-v1',
    environmentVariable: 'SES_TEMPLATE_DELETION_REMINDER_1D',
    subject: '账号将在 1 天后完成注销',
    variables: ['deadline'],
    html: htmlTemplate('账号将在 1 天后完成注销', [
      '账号预计于 {{deadline}}（中国标准时间 UTC+8）进入不可撤销清理。',
      '这是最后一次提醒；截止后即使后台仍在清理也不能恢复。',
    ], { label: '查看账号状态', href: 'https://www.yunle.fun/account-status' }),
    text: textTemplate([
      '账号预计于 {{deadline}}（中国标准时间 UTC+8）进入不可撤销清理。',
      '这是最后一次提醒。截止后即使后台仍在清理也不能恢复：https://www.yunle.fun/account-status',
    ]),
  },
  deletion_completed: {
    version: 1,
    name: 'yunlefun-account-deletion-completed-v1',
    environmentVariable: 'SES_TEMPLATE_DELETION_COMPLETED',
    subject: '账号注销已完成',
    variables: [],
    html: htmlTemplate('账号注销已完成', [
      '你的云乐坊认证身份、公开资料和核心登录绑定已经完成清理。',
      '用户名、手机号、邮箱和第三方登录绑定现已释放；依法需要保留的交易记录仍受严格访问控制。',
    ]),
    text: textTemplate([
      '你的云乐坊认证身份、公开资料和核心登录绑定已经完成清理。',
      '用户名、手机号、邮箱和第三方登录绑定现已释放；依法需要保留的交易记录仍受严格访问控制。',
    ]),
  },
  deletion_delayed: {
    version: 1,
    name: 'yunlefun-account-deletion-delayed-v1',
    environmentVariable: 'SES_TEMPLATE_DELETION_DELAYED',
    subject: '账号注销处理延迟',
    variables: [],
    html: htmlTemplate('账号注销处理延迟', [
      '账号清理已超过 24 小时仍未完成，我们正在自动重试并已通知运维人员。',
      '账号保持不可登录，绑定将在全部步骤成功后统一释放；你无需重复提交申请。',
    ], { label: '联系客服', href: 'https://www.yunle.fun/docs/contact' }),
    text: textTemplate([
      '账号清理已超过 24 小时仍未完成，我们正在自动重试并已通知运维人员。',
      '账号保持不可登录，绑定将在全部步骤成功后统一释放；你无需重复提交申请。帮助：https://www.yunle.fun/docs/contact',
    ]),
  },
  deletion_cleanup_ops: {
    version: 1,
    name: 'yunlefun-account-lifecycle-ops-v1',
    environmentVariable: 'SES_TEMPLATE_DELETION_CLEANUP_OPS',
    subject: '账号生命周期通知需要运维处理',
    variables: ['caseRef', 'failureCount', 'errorCode'],
    html: htmlTemplate('账号生命周期通知需要运维处理', [
      '案件引用：{{caseRef}}',
      '失败次数：{{failureCount}}',
      '脱敏错误码：{{errorCode}}',
      '请在内部日志中按案件引用排查；本邮件不包含用户 PII、邮件正文或错误堆栈。',
    ]),
    text: textTemplate([
      '账号生命周期通知需要运维处理。',
      '案件引用：{{caseRef}}',
      '失败次数：{{failureCount}}',
      '脱敏错误码：{{errorCode}}',
      '请在内部日志中按案件引用排查；本邮件不包含用户 PII、邮件正文或错误堆栈。',
    ]),
  },
})

module.exports = { SES_TEMPLATE_CATALOG }
