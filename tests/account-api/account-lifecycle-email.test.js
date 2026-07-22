import { describe, expect, it, vi } from 'vitest'

import {
  EmailDeliveryError,
  sendCloudflareEmail,
} from '../../cloudfunctions/account-lifecycle-notifier/delivery.js'
import { processNotificationJob } from '../../cloudfunctions/account-lifecycle-notifier/queue.js'
import { renderLifecycleEmail } from '../../cloudfunctions/account-lifecycle-notifier/templates.js'

const CONFIG = {
  accountId: 'cloudflare-account-id',
  apiToken: 'secret-email-token',
  fromAddress: 'noreply@yunle.fun',
  fromName: '云乐坊',
  replyTo: 'contact@yunle.fun',
}

describe('cloudflare Email Sending delivery', () => {
  it('发送命名发件人、reply-to、纯文本和 HTML 正文', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, result: { message_id: 'message-1', queued: ['user@example.com'] } }),
    }))

    await expect(sendCloudflareEmail(fetch, CONFIG, {
      to: 'user@example.com',
      subject: '账号注销申请已提交',
      text: '纯文本正文',
      html: '<p>HTML 正文</p>',
    })).resolves.toMatchObject({ id: 'message-1', message_id: 'message-1' })

    expect(fetch).toHaveBeenCalledWith(
      'https://api.cloudflare.com/client/v4/accounts/cloudflare-account-id/email/sending/send',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Authorization': 'Bearer secret-email-token',
          'Content-Type': 'application/json',
        },
      }),
    )
    const body = JSON.parse(fetch.mock.calls[0][1].body)
    expect(body).toEqual({
      from: { address: 'noreply@yunle.fun', name: '云乐坊' },
      reply_to: 'contact@yunle.fun',
      to: 'user@example.com',
      subject: '账号注销申请已提交',
      text: '纯文本正文',
      html: '<p>HTML 正文</p>',
    })
  })

  it.each([
    [400, false],
    [429, true],
    [500, true],
    [503, true],
  ])('hTTP %i 的 retryable=%s', async (status, retryable) => {
    const fetch = vi.fn(async () => ({
      ok: false,
      status,
      json: async () => ({ success: false, errors: [{ code: 1, message: 'provider error' }] }),
    }))
    const promise = sendCloudflareEmail(fetch, CONFIG, {
      to: 'user@example.com',
      subject: 'subject',
      text: 'text',
      html: '<p>text</p>',
    })
    await expect(promise).rejects.toBeInstanceOf(EmailDeliveryError)
    await expect(promise).rejects.toMatchObject({ status, retryable })
  })
})

describe('account lifecycle email templates', () => {
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
      markSent: vi.fn(async () => undefined),
      markFailed: vi.fn(async () => undefined),
      markSkipped: vi.fn(async () => undefined),
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
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: 'verified@example.com' }))
    expect(store.markSent).toHaveBeenCalledWith('job-1', 1_700_000_000_000, 'message-1')

    store.getRememberedRecipient.mockResolvedValueOnce('verified@example.com')
    resolveRecipient.mockResolvedValueOnce(null)
    await processNotificationJob({
      _id: 'job-2',
      userId: 'u1',
      type: 'deletion_completed',
      attemptCount: 0,
    }, { store, send, resolveRecipient, now: 1_700_000_000_001 })
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ to: 'verified@example.com' }))
  })

  it('发送失败只记录任务重试，不抛出阻断业务状态', async () => {
    const store = {
      getRememberedRecipient: vi.fn(async () => 'verified@example.com'),
      rememberRecipient: vi.fn(),
      markSent: vi.fn(),
      markFailed: vi.fn(async () => undefined),
      markSkipped: vi.fn(),
    }
    const error = new EmailDeliveryError('rate limited', { status: 429, retryable: true })

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
})
