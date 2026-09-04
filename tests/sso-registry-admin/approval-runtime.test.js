import { describe, expect, it, vi } from 'vitest'

import {
  createApprovalEmailSender,
  createStrictApproverResolver,
  loadApprovalRuntimeConfig,
} from '../../cloudfunctions/sso-registry-admin/approval-runtime.js'

describe('sso-registry approval runtime', () => {
  it('accepts one active CloudBase management user with the exact configured uid', async () => {
    const manager = {
      user: {
        describeUserList: vi.fn(async () => ({
          Data: {
            UserList: [{ Uid: 'admin-uid', Email: 'admin@example.com', UserStatus: 'ACTIVE' }],
          },
        })),
      },
    }
    const resolve = createStrictApproverResolver(manager)

    await expect(resolve('admin-uid')).resolves.toBe('admin@example.com')
    expect(manager.user.describeUserList).toHaveBeenCalledWith({
      uidList: ['admin-uid'],
      pageNo: 1,
      pageSize: 2,
    })
  })

  it.each([
    ['no matching user', []],
    ['duplicate users', [
      { Uid: 'admin-uid', Email: 'admin@example.com', UserStatus: 'ACTIVE' },
      { Uid: 'admin-uid', Email: 'admin@example.com', UserStatus: 'ACTIVE' },
    ]],
    ['a mismatched uid', [
      { Uid: 'other-uid', Email: 'admin@example.com', UserStatus: 'ACTIVE' },
    ]],
  ])('fails closed for %s', async (_label, users) => {
    const manager = {
      user: {
        describeUserList: vi.fn(async () => ({ Data: { UserList: users } })),
      },
    }
    const resolve = createStrictApproverResolver(manager)

    await expect(resolve('admin-uid')).resolves.toBeNull()
  })

  it.each([
    ['an inactive account', { Uid: 'admin-uid', Email: 'admin@example.com', UserStatus: 'BLOCKED' }],
    ['a malformed email', { Uid: 'admin-uid', Email: 'not-an-email', UserStatus: 'ACTIVE' }],
  ])('fails closed for %s', async (_label, user) => {
    const manager = {
      user: {
        describeUserList: vi.fn(async () => ({
          Data: { UserList: [user] },
        })),
      },
    }
    const resolve = createStrictApproverResolver(manager)

    await expect(resolve('admin-uid')).resolves.toBeNull()
  })

  it('fails closed when the CloudBase management lookup is unavailable', async () => {
    const manager = {
      user: {
        describeUserList: vi.fn(async () => {
          throw new Error('identity lookup unavailable')
        }),
      },
    }
    const resolve = createStrictApproverResolver(manager)

    await expect(resolve('admin-uid')).rejects.toThrow('identity lookup unavailable')
  })

  it('loads production approval configuration and sends the code through SES templates', async () => {
    const config = loadApprovalRuntimeConfig({
      SES_FROM_EMAIL: 'account@notify.yunle.fun',
      SES_FROM_NAME: '云乐坊账号安全',
      SES_REGION: 'ap-guangzhou',
      SES_REPLY_TO: 'kf@yunle.fun',
      SES_TEMPLATE_REGISTRY_APPROVAL: '123',
      SSO_REGISTRY_APPROVAL_PEPPER: 'p'.repeat(32),
      SSO_REGISTRY_APPROVER_UIDS: '["admin-uid"]',
    })
    const client = { SendEmail: vi.fn(async () => ({ MessageId: 'message-1', RequestId: 'request-1' })) }
    const send = createApprovalEmailSender(client, config)

    await expect(send({
      approvalId: 'approval:test',
      to: 'admin@example.com',
      code: '23456789ABCD',
      environment: 'production',
      policyVersion: '2026-08-08.1',
      clientCount: 12,
      diffSummary: { added: ['sample-web'], modified: [], removed: [] },
      contentHash: 'a'.repeat(64),
      securityHash: 'b'.repeat(64),
      requester: 'maintainer',
      changeReason: 'add sample',
      expiresAt: 1_785_700_000_000,
    })).resolves.toEqual({ id: 'message-1', requestId: 'request-1' })
    expect(client.SendEmail).toHaveBeenCalledWith(expect.objectContaining({
      Destination: ['admin@example.com'],
      Template: expect.objectContaining({ TemplateID: 123 }),
    }))
    expect(JSON.parse(client.SendEmail.mock.calls[0][0].Template.TemplateData)).toMatchObject({
      code: '23456789ABCD',
      policyVersion: '2026-08-08.1',
    })
  })
})
