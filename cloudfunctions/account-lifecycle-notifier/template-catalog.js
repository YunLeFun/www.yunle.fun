/** Versioned Tencent Cloud SES template sources and variable contracts. */

'use strict'

const EMAIL_TONES = Object.freeze({
  info: {
    accent: '#2563EB',
    soft: '#EFF6FF',
    text: '#1D4ED8',
  },
  warning: {
    accent: '#D97706',
    soft: '#FFF7ED',
    text: '#B45309',
  },
  critical: {
    accent: '#DC2626',
    soft: '#FEF2F2',
    text: '#B91C1C',
  },
  success: {
    accent: '#059669',
    soft: '#ECFDF5',
    text: '#047857',
  },
})

function renderParagraphs(paragraphs) {
  return paragraphs
    .map(text => `<p style="margin:0 0 14px;font-size:15px;line-height:1.8;color:#475569;">${text}</p>`)
    .join('')
}

function renderDetails(details) {
  if (!details?.length)
    return ''

  const rows = details
    .map(({ label, value }) => `
                          <tr>
                            <td valign="top" style="padding:7px 16px 7px 0;font-size:13px;line-height:1.6;color:#64748B;white-space:nowrap;">${label}</td>
                            <td valign="top" style="padding:7px 0;font-size:14px;line-height:1.6;color:#0F172A;font-weight:600;word-break:break-word;">${value}</td>
                          </tr>`)
    .join('')

  return `
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#F8FAFC" style="width:100%;margin:6px 0 20px;background-color:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;">
                      <tr>
                        <td style="padding:11px 16px;">
                          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                            ${rows}
                          </table>
                        </td>
                      </tr>
                    </table>`
}

function renderAction(action) {
  if (!action)
    return ''

  return `
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0 12px;">
                      <tr>
                        <td align="center" bgcolor="#2563EB" style="border-radius:8px;background-color:#2563EB;">
                          <a href="${action.href}" style="display:inline-block;min-width:120px;padding:0 22px;font-size:15px;font-weight:600;line-height:44px;color:#FFFFFF;text-align:center;text-decoration:none;border-radius:8px;">${action.label}</a>
                        </td>
                      </tr>
                    </table>
                    <p style="margin:0 0 14px;font-size:12px;line-height:1.7;color:#94A3B8;">按钮无法打开？复制此地址到浏览器：<br><a href="${action.href}" style="color:#64748B;text-decoration:underline;word-break:break-all;">${action.href}</a></p>`
}

function htmlTemplate({
  title,
  preheader,
  status,
  tone = 'info',
  paragraphs,
  details,
  action,
  notice,
  audience = 'user',
}) {
  const palette = EMAIL_TONES[tone]
  const content = renderParagraphs(paragraphs)
  const detailPanel = renderDetails(details)
  const button = renderAction(action)
  const privacyNotice = notice
    ? `
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${palette.soft}" style="width:100%;margin:8px 0 0;background-color:${palette.soft};border-left:3px solid ${palette.accent};">
                      <tr>
                        <td style="padding:12px 14px;font-size:13px;line-height:1.7;color:#475569;">${notice}</td>
                      </tr>
                    </table>`
    : ''
  const footer = audience === 'ops'
    ? '云乐坊账号安全 · 内部运维通知，请勿转发'
    : '这是一封账号安全事务通知。如需帮助，请直接回复本邮件。'

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="color-scheme" content="light only">
    <meta name="supported-color-schemes" content="light">
    <title>${title}</title>
  </head>
  <body bgcolor="#F4F9FF" style="margin:0;padding:0;background-color:#F4F9FF;font-family:Arial,'PingFang SC','Microsoft YaHei',sans-serif;-webkit-text-size-adjust:100%;">
    <div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${preheader}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#F4F9FF" style="width:100%;background-color:#F4F9FF;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" bgcolor="#FFFFFF" style="width:100%;max-width:600px;background-color:#FFFFFF;border:1px solid #DBEAFE;border-radius:14px;overflow:hidden;">
            <tr>
              <td style="padding:0;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;height:5px;">
                  <tr>
                    <td width="58%" height="5" bgcolor="#2563EB" style="height:5px;background-color:#2563EB;font-size:0;line-height:0;">&nbsp;</td>
                    <td width="30%" height="5" bgcolor="#0EA5E9" style="height:5px;background-color:#0EA5E9;font-size:0;line-height:0;">&nbsp;</td>
                    <td width="12%" height="5" bgcolor="#F59E0B" style="height:5px;background-color:#F59E0B;font-size:0;line-height:0;">&nbsp;</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 32px 30px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td style="padding:0 0 26px;font-size:14px;line-height:1.4;color:#2563EB;font-weight:700;letter-spacing:.04em;">云乐坊 · 账号安全</td>
                  </tr>
                  <tr>
                    <td style="padding:0;">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" bgcolor="${palette.soft}" style="margin:0 0 14px;background-color:${palette.soft};border-radius:999px;">
                        <tr>
                          <td style="padding:5px 10px;font-size:12px;line-height:1.2;color:${palette.text};font-weight:700;">${status}</td>
                        </tr>
                      </table>
                      <h1 style="margin:0 0 20px;font-size:24px;line-height:1.4;color:#0F172A;font-weight:700;">${title}</h1>
                      ${content}
                      ${detailPanel}
                      ${button}
                      ${privacyNotice}
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td bgcolor="#F8FAFC" style="padding:18px 32px;background-color:#F8FAFC;border-top:1px solid #E2E8F0;font-size:12px;line-height:1.7;color:#64748B;">${footer}</td>
            </tr>
          </table>
          <p style="margin:14px 0 0;font-size:11px;line-height:1.6;color:#94A3B8;">© 云乐坊 · 让每一次相遇都有回响</p>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

function textTemplate(lines, audience = 'user') {
  const footer = audience === 'ops'
    ? '云乐坊账号安全 · 内部运维通知，请勿转发。'
    : '云乐坊账号安全通知\n如需帮助，请直接回复本邮件。'
  return `${lines.join('\n\n')}\n\n${footer}`
}

const ACCOUNT_STATUS_ACTION = Object.freeze({
  label: '查看账号状态',
  href: 'https://www.yunle.fun/account-status',
})

const SES_TEMPLATE_CATALOG = Object.freeze({
  deletion_requested: {
    version: 2,
    name: 'yunlefun-account-deletion-requested-v2',
    environmentVariable: 'SES_TEMPLATE_DELETION_REQUESTED',
    subject: '账号注销申请已提交',
    variables: ['deadline'],
    html: htmlTemplate({
      title: '账号注销申请已提交',
      preheader: '账号已进入 30 天注销冷静期，可在截止时间前主动恢复。',
      status: '冷静期进行中',
      tone: 'info',
      paragraphs: [
        '你的云乐坊账号已进入 30 天注销冷静期，账号功能现已冻结。',
        '登录或打开本邮件都不会自动撤销注销。如需继续使用，请在截止时间前进入账号状态页，并明确确认恢复。',
      ],
      details: [
        { label: '可恢复截止时间', value: '{{deadline}}（中国标准时间 UTC+8）' },
      ],
      action: { ...ACCOUNT_STATUS_ACTION, label: '恢复账号' },
      notice: '如果这不是你本人的操作，请尽快回复本邮件联系我们。',
    }),
    text: textTemplate([
      '你的云乐坊账号已进入 30 天注销冷静期，账号功能现已冻结。',
      '可恢复截止时间：{{deadline}}，中国标准时间（UTC+8）。',
      '登录不会自动撤销注销，打开邮件也不会。如需继续使用，请在截止时间前访问：https://www.yunle.fun/account-status',
      '如果这不是你本人的操作，请尽快回复本邮件联系我们。',
    ]),
  },
  deletion_reminder_7d: {
    version: 2,
    name: 'yunlefun-account-deletion-reminder-7d-v2',
    environmentVariable: 'SES_TEMPLATE_DELETION_REMINDER_7D',
    subject: '账号将在 7 天后完成注销',
    variables: ['deadline'],
    html: htmlTemplate({
      title: '账号将在 7 天后完成注销',
      preheader: '账号注销冷静期还剩 7 天，如需保留账号，请在截止时间前主动恢复。',
      status: '还剩 7 天',
      tone: 'warning',
      paragraphs: [
        '你的账号即将进入不可撤销清理。若你改变主意，请在截止时间前进入账号状态页并明确确认恢复。',
      ],
      details: [
        { label: '可恢复截止时间', value: '{{deadline}}（中国标准时间 UTC+8）' },
      ],
      action: ACCOUNT_STATUS_ACTION,
    }),
    text: textTemplate([
      '账号预计于 {{deadline}}（中国标准时间 UTC+8）进入不可撤销清理。',
      '若你改变主意，请在截止时间前访问：https://www.yunle.fun/account-status',
    ]),
  },
  deletion_reminder_1d: {
    version: 2,
    name: 'yunlefun-account-deletion-reminder-1d-v2',
    environmentVariable: 'SES_TEMPLATE_DELETION_REMINDER_1D',
    subject: '账号将在 1 天后完成注销',
    variables: ['deadline'],
    html: htmlTemplate({
      title: '账号将在 1 天后完成注销',
      preheader: '这是账号注销前的最后一次提醒，截止后将无法恢复。',
      status: '最后提醒',
      tone: 'critical',
      paragraphs: [
        '这是最后一次提醒。账号将在截止时间后进入不可撤销清理；即使后台仍在执行清理，届时也不能恢复。',
      ],
      details: [
        { label: '可恢复截止时间', value: '{{deadline}}（中国标准时间 UTC+8）' },
      ],
      action: ACCOUNT_STATUS_ACTION,
      notice: '若需保留账号，请务必在截止时间前完成恢复确认。',
    }),
    text: textTemplate([
      '账号预计于 {{deadline}}（中国标准时间 UTC+8）进入不可撤销清理。',
      '这是最后一次提醒。截止后即使后台仍在清理也不能恢复：https://www.yunle.fun/account-status',
    ]),
  },
  deletion_completed: {
    version: 2,
    name: 'yunlefun-account-deletion-completed-v2',
    environmentVariable: 'SES_TEMPLATE_DELETION_COMPLETED',
    subject: '账号注销已完成',
    variables: [],
    html: htmlTemplate({
      title: '账号注销已完成',
      preheader: '你的账号身份、公开资料和核心登录绑定已经完成清理。',
      status: '处理完成',
      tone: 'success',
      paragraphs: [
        '你的云乐坊认证身份、公开资料和核心登录绑定已经完成清理。',
        '用户名、手机号、邮箱和第三方登录绑定现已释放；依法需要保留的交易记录仍受严格访问控制。',
      ],
      notice: '此操作已经完成，原账号无法恢复。如需再次使用云乐坊，可重新注册账号。',
    }),
    text: textTemplate([
      '你的云乐坊认证身份、公开资料和核心登录绑定已经完成清理。',
      '用户名、手机号、邮箱和第三方登录绑定现已释放；依法需要保留的交易记录仍受严格访问控制。',
      '此操作已经完成，原账号无法恢复。如需再次使用云乐坊，可重新注册账号。',
    ]),
  },
  deletion_delayed: {
    version: 2,
    name: 'yunlefun-account-deletion-delayed-v2',
    environmentVariable: 'SES_TEMPLATE_DELETION_DELAYED',
    subject: '账号注销处理延迟',
    variables: [],
    html: htmlTemplate({
      title: '账号注销处理有所延迟',
      preheader: '账号清理仍在进行，我们正在自动重试，你无需重复提交申请。',
      status: '处理中',
      tone: 'warning',
      paragraphs: [
        '账号清理已超过 24 小时仍未完成，我们正在自动重试，并已通知运维人员跟进。',
        '在所有步骤完成前，账号将保持不可登录，相关绑定也不会提前释放。你无需重复提交申请。',
      ],
      action: {
        label: '查看帮助',
        href: 'https://www.yunle.fun/docs/contact',
      },
      notice: '我们会在处理完成后再次通知你。给你带来不便，敬请谅解。',
    }),
    text: textTemplate([
      '账号清理已超过 24 小时仍未完成，我们正在自动重试并已通知运维人员。',
      '账号保持不可登录，绑定将在全部步骤成功后统一释放；你无需重复提交申请。帮助：https://www.yunle.fun/docs/contact',
      '我们会在处理完成后再次通知你。',
    ]),
  },
  deletion_cleanup_ops: {
    version: 2,
    name: 'yunlefun-account-lifecycle-ops-v2',
    environmentVariable: 'SES_TEMPLATE_DELETION_CLEANUP_OPS',
    subject: '【需处理】账号生命周期任务异常',
    variables: ['caseRef', 'failureCount', 'errorCode'],
    html: htmlTemplate({
      title: '账号生命周期任务异常',
      preheader: '账号生命周期任务多次失败，需要运维人员按案件引用排查。',
      status: '需要处理',
      tone: 'warning',
      paragraphs: [
        '账号生命周期任务多次失败，请按案件引用在内部日志中排查。',
      ],
      details: [
        { label: '案件引用', value: '{{caseRef}}' },
        { label: '失败次数', value: '{{failureCount}}' },
        { label: '脱敏错误码', value: '{{errorCode}}' },
      ],
      notice: '为保护用户隐私，本邮件不包含用户 PII、邮件正文或错误堆栈。',
      audience: 'ops',
    }),
    text: textTemplate([
      '账号生命周期任务异常，需要运维处理。',
      '案件引用：{{caseRef}}',
      '失败次数：{{failureCount}}',
      '脱敏错误码：{{errorCode}}',
      '请在内部日志中按案件引用排查。本邮件不包含用户 PII、邮件正文或错误堆栈。',
    ], 'ops'),
  },
})

module.exports = { SES_TEMPLATE_CATALOG }
