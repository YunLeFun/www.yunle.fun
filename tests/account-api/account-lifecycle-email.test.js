import { describe, expect, it, vi } from 'vitest'

import { loadEmailConfig } from '../../cloudfunctions/account-lifecycle-notifier/config.js'
import {
  EmailDeliveryError,
  getTencentEmailStatus,
  sendTencentEmail,
} from '../../cloudfunctions/account-lifecycle-notifier/delivery.js'
import { processNotificationJob } from '../../cloudfunctions/account-lifecycle-notifier/queue.js'
import { SES_TEMPLATE_CATALOG } from '../../cloudfunctions/account-lifecycle-notifier/template-catalog.js'
import { renderLifecycleEmail } from '../../cloudfunctions/account-lifecycle-notifier/templates.js'

const CONFIG = {
  fromAddress: 'account@notify.yunle.fun',
  fromName: '云乐坊账号安全',
  replyTo: 'kf@yunle.fun',
  templateIds: {
    deletion_requested: 101,
  },
}

describe('account lifecycle notifier config', () => {
  it('默认 dry-run，只有显式 live 才启用真实发送', () => {
    const base = loadEmailConfig({})
    const live = loadEmailConfig({
      ACCOUNT_LIFECYCLE_EMAIL_MODE: 'live',
      ACCOUNT_LIFECYCLE_DAILY_USER_LIMIT: '45',
      ACCOUNT_LIFECYCLE_DAILY_OPS_LIMIT: '5',
      SES_TEMPLATE_DELETION_REQUESTED: '101',
    })

    expect(base).toMatchObject({
      mode: 'dry_run',
      region: 'ap-guangzhou',
      fromAddress: 'account@notify.yunle.fun',
      opsEmail: 'security@yunle.fun',
      userDailyLimit: 45,
      opsDailyLimit: 5,
    })
    expect(live.mode).toBe('live')
    expect(live.templateIds.deletion_requested).toBe(101)
  })
})

describe('tencent Cloud SES delivery', () => {
  it('使用审核模板发送事务邮件且明确关闭退订', async () => {
    const client = {
      SendEmail: vi.fn(async () => ({ MessageId: 'message-1', RequestId: 'request-1' })),
    }

    await expect(sendTencentEmail(client, CONFIG, {
      id: 'job-1',
      type: 'deletion_requested',
      to: 'user@example.com',
      subject: '账号注销申请已提交',
      templateData: {
        deadline: '2026年7月31日 09:30',
      },
    })).resolves.toEqual({ id: 'message-1', requestId: 'request-1' })

    expect(client.SendEmail).toHaveBeenCalledWith({
      Destination: ['user@example.com'],
      FromEmailAddress: '云乐坊账号安全 <account@notify.yunle.fun>',
      ReplyToAddresses: 'kf@yunle.fun',
      Subject: '账号注销申请已提交',
      Template: {
        TemplateData: JSON.stringify({
          deadline: '2026年7月31日 09:30',
        }),
        TemplateID: 101,
      },
      TriggerType: 1,
      Unsubscribe: '0',
      SmtpMessageId: '<job-1@notify.yunle.fun>',
    })
  })

  it.each([
    ['RequestLimitExceeded', true],
    ['InternalError', true],
    ['InvalidParameterValue', false],
    ['FailedOperation.EmailAddressInBlacklist', false],
  ])('%s 的 retryable=%s', async (code, retryable) => {
    const client = {
      SendEmail: vi.fn(async () => {
        const error = new Error('provider details must not escape')
        error.code = code
        error.requestId = 'request-1'
        throw error
      }),
    }
    const promise = sendTencentEmail(client, CONFIG, {
      id: 'job-1',
      type: 'deletion_requested',
      to: 'user@example.com',
      subject: 'subject',
      templateData: {},
    })
    await expect(promise).rejects.toBeInstanceOf(EmailDeliveryError)
    await expect(promise).rejects.toMatchObject({
      code,
      retryable,
      requestId: 'request-1',
      message: '邮件服务拒绝发送请求',
    })
  })

  it('只返回投递状态和脱敏状态码，不返回收件地址或服务商原因', async () => {
    const client = {
      GetSendEmailStatus: vi.fn(async () => ({
        EmailStatusList: [{
          MessageId: 'message-1',
          ToEmailAddress: 'private@example.com',
          SendStatus: 0,
          DeliverStatus: 3,
          DeliverMessage: '550 private@example.com mailbox unavailable',
          UserComplained: false,
        }],
      })),
    }

    await expect(getTencentEmailStatus(client, {
      messageId: 'message-1',
      submittedAt: Date.UTC(2026, 6, 23, 1, 30),
    })).resolves.toEqual({
      state: 'bounced',
      sendStatus: 0,
      deliverStatus: 3,
      complained: false,
      deliverTime: null,
    })
    expect(client.GetSendEmailStatus).toHaveBeenCalledWith({
      Limit: 10,
      MessageId: 'message-1',
      Offset: 0,
      RequestDate: '2026-07-23',
    })
  })

  it('用户投诉优先于已递送状态', async () => {
    const client = {
      GetSendEmailStatus: vi.fn(async () => ({
        EmailStatusList: [{
          MessageId: 'message-1',
          SendStatus: 0,
          DeliverStatus: 1,
          DeliverTime: 1_700_000_000,
          UserComplained: true,
        }],
      })),
    }
    await expect(getTencentEmailStatus(client, {
      messageId: 'message-1',
      submittedAt: Date.UTC(2026, 6, 23, 1, 30),
    })).resolves.toMatchObject({ state: 'complained', complained: true })
  })
})

describe('account lifecycle email templates', () => {
  it('仓库保存六个版本化 SES 模板及其变量契约', () => {
    expect(Object.keys(SES_TEMPLATE_CATALOG)).toEqual([
      'deletion_requested',
      'deletion_reminder_7d',
      'deletion_reminder_1d',
      'deletion_completed',
      'deletion_delayed',
      'deletion_cleanup_ops',
    ])
    expect(SES_TEMPLATE_CATALOG.deletion_requested).toMatchObject({
      environmentVariable: 'SES_TEMPLATE_DELETION_REQUESTED',
      variables: ['deadline'],
      version: 1,
    })
    expect(SES_TEMPLATE_CATALOG.deletion_requested.html).toContain('{{deadline}}')
    expect(SES_TEMPLATE_CATALOG.deletion_cleanup_ops.variables).toEqual([
      'caseRef',
      'failureCount',
      'errorCode',
    ])
  })

  it('申请邮件包含精确中国时区截止时间与恢复说明', () => {
    const email = renderLifecycleEmail({
      type: 'deletion_requested',
      deletionScheduledAt: Date.UTC(2026, 6, 31, 1, 30),
    })
    expect(email.subject).toBe('账号注销申请已提交')
    expect(email.text).toContain('2026年7月31日 09:30')
    expect(email.text).toContain('中国标准时间（UTC+8）')
    expect(email.text).toContain('登录不会自动撤销')
    expect(email.html).toContain('恢复账号')
  })

  it('完成和延迟模板不泄露内部错误', () => {
    const completed = renderLifecycleEmail({ type: 'deletion_completed' })
    const delayed = renderLifecycleEmail({ type: 'deletion_delayed' })
    expect(completed.subject).toContain('注销已完成')
    expect(delayed.subject).toContain('处理延迟')
    expect(delayed.text).not.toContain('stack')
  })
})

describe('notification job processing', () => {
  it('缓存已验证邮箱，供 Auth 删除后的完成邮件复用', async () => {
    const store = {
      getRememberedRecipient: vi.fn(async () => null),
      rememberRecipient: vi.fn(async () => undefined),
      reserveQuota: vi.fn(async () => ({ reserved: true, bucket: 'user' })),
      markSubmitted: vi.fn(async () => undefined),
      markFailed: vi.fn(async () => undefined),
      markSkipped: vi.fn(async () => undefined),
      finishLifecycleContact: vi.fn(async () => undefined),
    }
    const send = vi.fn(async () => ({ id: 'message-1' }))
    const resolveRecipient = vi.fn(async () => 'verified@example.com')

    await processNotificationJob({
      _id: 'job-1',
      userId: 'u1',
      type: 'deletion_requested',
      deletionScheduledAt: Date.UTC(2026, 6, 31, 1, 30),
      attemptCount: 0,
    }, { store, send, resolveRecipient, now: 1_700_000_000_000 })

    expect(store.rememberRecipient).toHaveBeenCalledWith('u1', 'verified@example.com', 1_700_000_000_000)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      id: 'job-1',
      type: 'deletion_requested',
      to: 'verified@example.com',
    }))
    expect(store.markSubmitted).toHaveBeenCalledWith('job-1', 1_700_000_000_000, 'message-1')

    store.getRememberedRecipient.mockResolvedValueOnce('verified@example.com')
    resolveRecipient.mockResolvedValueOnce(null)
    await processNotificationJob({
      _id: 'job-2',
      userId: 'u1',
      type: 'deletion_completed',
      attemptCount: 0,
    }, { store, send, resolveRecipient, now: 1_700_000_000_001 })
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ to: 'verified@example.com' }))
    expect(store.finishLifecycleContact).toHaveBeenCalledWith('u1', undefined, 1_700_000_000_001)
  })

  it('发送失败只记录任务重试，不抛出阻断业务状态', async () => {
    const store = {
      getRememberedRecipient: vi.fn(async () => 'verified@example.com'),
      rememberRecipient: vi.fn(),
      reserveQuota: vi.fn(async () => ({ reserved: true, bucket: 'user' })),
      markSubmitted: vi.fn(),
      markFailed: vi.fn(async () => undefined),
      markSkipped: vi.fn(),
    }
    const error = new EmailDeliveryError('rate limited', {
      code: 'RequestLimitExceeded',
      retryable: true,
    })

    await expect(processNotificationJob({
      _id: 'job-1',
      userId: 'u1',
      type: 'deletion_reminder_7d',
      attemptCount: 1,
    }, {
      store,
      send: vi.fn(async () => { throw error }),
      resolveRecipient: vi.fn(),
      now: 1_700_000_000_000,
    })).resolves.toMatchObject({ sent: false, retryable: true })
    expect(store.markFailed).toHaveBeenCalledWith('job-1', 1_700_000_000_000, expect.objectContaining({ retryable: true }))
  })

  it('每日用户额度用尽后保留 pending，不调用 SES', async () => {
    const store = {
      getRememberedRecipient: vi.fn(async () => 'verified@example.com'),
      rememberRecipient: vi.fn(),
      reserveQuota: vi.fn(async () => ({ reserved: false, bucket: 'user' })),
      markSubmitted: vi.fn(),
      markFailed: vi.fn(),
      markSkipped: vi.fn(),
    }
    const send = vi.fn()

    await expect(processNotificationJob({
      _id: 'job-1',
      userId: 'u1',
      type: 'deletion_reminder_1d',
      attemptCount: 0,
    }, {
      store,
      send,
      resolveRecipient: vi.fn(),
      now: 1_700_000_000_000,
    })).resolves.toMatchObject({ sent: false, deferred: true })
    expect(send).not.toHaveBeenCalled()
    expect(store.markFailed).not.toHaveBeenCalled()
  })
})
