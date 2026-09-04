import { describe, expect, it, vi } from 'vitest'

import {
  createApprovalEmailSender,
  createStrictApproverResolver,
  loadApprovalRuntimeConfig,
} from '../../cloudfunctions/sso-registry-admin/approval-runtime.js'

describe('sso-registry approval runtime', () => {
  it('accepts the production CloudBase user shape when the uid auth view matches', async () => {
    const manager = {
      user: {
        describeUserList: vi.fn(async () => ({
          Data: {
            UserList: [{ Uid: 'admin-uid', Email: 'admin@example.com', UserStatus: 'ACTIVE' }],
          },
        })),
      },
    }
    const auth = {
      getEndUserInfo: vi.fn(async uid => ({
        userInfo: { uid, email: 'admin@example.com' },
      })),
      queryUserInfo: vi.fn(),
    }
    const resolve = createStrictApproverResolver(manager, auth)

    await expect(resolve('admin-uid')).resolves.toBe('admin@example.com')
    expect(auth.getEndUserInfo).toHaveBeenCalledWith('admin-uid')
    expect(auth.queryUserInfo).not.toHaveBeenCalled()
  })

  it('resolves only the configured uid with matching active user and auth views', async () => {
    const manager = {
      user: {
        describeUserList: vi.fn(async ({ uidList }) => ({
          Data: {
            UserList: [{ Uid: uidList[0], Email: 'admin@example.com', UserStatus: 'ACTIVE' }],
          },
        })),
      },
    }
    const auth = {
      getEndUserInfo: vi.fn(async uid => ({
        userInfo: { uid, email: 'ADMIN@example.com' },
      })),
    }
    const resolve = createStrictApproverResolver(manager, auth)

    await expect(resolve('admin-uid')).resolves.toBe('admin@example.com')
    expect(auth.getEndUserInfo).toHaveBeenCalledWith('admin-uid')
  })

  it('fails closed when the email identity cannot confirm the same active uid', async () => {
    const manager = {
      user: {
        describeUserList: vi.fn(async () => ({
          Data: {
            UserList: [{ Uid: 'admin-uid', Email: 'admin@example.com', UserStatus: 'ACTIVE' }],
          },
        })),
      },
    }
    const auth = {
      getEndUserInfo: vi.fn()
        .mockResolvedValueOnce({ userInfo: { uid: 'other-uid', email: 'admin@example.com' } })
        .mockResolvedValueOnce({ userInfo: { uid: 'admin-uid', email: 'other@example.com' } })
        .mockRejectedValueOnce(new Error('identity lookup unavailable')),
    }
    const resolve = createStrictApproverResolver(manager, auth)

    await expect(resolve('admin-uid')).resolves.toBeNull()
    await expect(resolve('admin-uid')).resolves.toBeNull()
    await expect(resolve('admin-uid')).resolves.toBeNull()

    manager.user.describeUserList.mockResolvedValueOnce({
      Data: {
        UserList: [{
          Uid: 'admin-uid',
          Email: 'admin@example.com',
          UserStatus: 'BLOCKED',
        }],
      },
    })
    await expect(resolve('admin-uid')).resolves.toBeNull()
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
