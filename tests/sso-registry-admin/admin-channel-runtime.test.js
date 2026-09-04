import { describe, expect, it, vi } from 'vitest'

import {
  createAdminChannelClient,
  createAdminChannelRequestVerifier,
  loadAdminChannelConfig,
  signAdminChannelInvocation,
  signature,
} from '../../cloudfunctions/sso-registry-admin/admin-channel-runtime.js'

const SECRET = 'registry-admin-channel-secret-at-least-32-bytes'

describe('registry Admin HMAC channel', () => {
  it('signs method, path, timestamp and exact body hash', () => {
    const first = signature(SECRET, 'POST', '/deliver', '1000', '{"a":1}')
    expect(first).toMatch(/^[a-f0-9]{64}$/)
    expect(signature(SECRET, 'POST', '/status', '1000', '{"a":1}')).not.toBe(first)
    expect(signature(SECRET, 'POST', '/deliver', '1001', '{"a":1}')).not.toBe(first)
    expect(signature(SECRET, 'POST', '/deliver', '1000', '{"a":2}')).not.toBe(first)
  })

  it('keeps the feature disabled by default and validates production configuration', () => {
    expect(loadAdminChannelConfig({})).toEqual({ enabled: false })
    expect(() => loadAdminChannelConfig({
      SSO_REGISTRY_FEISHU_APPROVAL_ENABLED: 'true',
      SSO_REGISTRY_ADMIN_CHANNEL_SECRET: 'short',
    })).toThrow(/at least 32 bytes/)
    expect(loadAdminChannelConfig({
      SSO_REGISTRY_FEISHU_APPROVAL_ENABLED: 'true',
      SSO_REGISTRY_ADMIN_CHANNEL_SECRET: SECRET,
    })).toEqual({
      enabled: true,
      baseUrl: 'https://admin.yunle.fun',
      secret: SECRET,
    })
  })

  it('sends signed JSON to fixed Admin endpoints', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        data: { id: 'om_test', externalIdentityHash: 'a'.repeat(64) },
      }),
    }))
    const client = createAdminChannelClient({
      enabled: true,
      baseUrl: 'https://admin.yunle.fun',
      secret: SECRET,
    }, { fetchImpl, now: () => 1_000 })

    await client.sendApprovalCard({ approvalId: 'approval:test' })

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://admin.yunle.fun/api/internal/sso-registry/approvals/deliver',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-yunlefun-registry-timestamp': '1000',
          'x-yunlefun-registry-signature': expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    )
  })

  it('verifies short-lived CloudBase read invocations and rejects replay windows', () => {
    const verifier = createAdminChannelRequestVerifier(SECRET, { now: () => 10_000 })
    const signed = signAdminChannelInvocation(SECRET, 'getApprovalForAdmin', 'approval:test', 10_000)
    expect(() => verifier({
      action: 'getApprovalForAdmin',
      approvalId: 'approval:test',
      ...signed,
    })).not.toThrow()
    expect(() => verifier({
      action: 'getApprovalForAdmin',
      approvalId: 'approval:tampered',
      ...signed,
    })).toThrow(expect.objectContaining({ code: 'admin_channel_identity_required' }))

    const expired = createAdminChannelRequestVerifier(SECRET, { now: () => 80_001 })
    expect(() => expired({
      action: 'getApprovalForAdmin',
      approvalId: 'approval:test',
      ...signed,
    })).toThrow(expect.objectContaining({ code: 'admin_channel_identity_required' }))
  })
})
