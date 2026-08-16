import { describe, expect, it, vi } from 'vitest'
import { CloudBaseAuthHttpVerifier } from '../auth/cloudbase-http.js'

describe('cloudBase access token verification', () => {
  it('calls the fixed user/me endpoint and returns only the canonical uid', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      sub: 'uid_fixture_001',
      nickname: 'Must not be propagated',
    }), { status: 200 }))
    const verifier = new CloudBaseAuthHttpVerifier({
      envId: 'yunlefun-test-123456',
      fetch,
    })

    await expect(verifier.verifyAccessToken('access-token-fixture')).resolves.toEqual({ uid: 'uid_fixture_001' })
    expect(fetch).toHaveBeenCalledWith(
      'https://yunlefun-test-123456.api.tcloudbasegateway.com/auth/v1/user/me',
      {
        headers: { Authorization: 'Bearer access-token-fixture' },
        method: 'GET',
        signal: expect.any(AbortSignal),
      },
    )
  })

  it('rejects invalid environments, failed tokens and anonymous profiles', async () => {
    expect(() => new CloudBaseAuthHttpVerifier({
      envId: 'https://attacker.invalid',
      fetch: vi.fn(),
    })).toThrowError(/environment id/i)

    const rejected = new CloudBaseAuthHttpVerifier({
      envId: 'yunlefun-test-123456',
      fetch: vi.fn(async () => new Response('{}', { status: 401 })),
    })
    await expect(rejected.verifyAccessToken('expired-token')).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })

    const anonymous = new CloudBaseAuthHttpVerifier({
      envId: 'yunlefun-test-123456',
      fetch: vi.fn(async () => new Response(JSON.stringify({
        sub: 'anonymous_uid',
        is_anonymous: true,
      }), { status: 200 })),
    })
    await expect(anonymous.verifyAccessToken('anonymous-token')).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
  })
})
