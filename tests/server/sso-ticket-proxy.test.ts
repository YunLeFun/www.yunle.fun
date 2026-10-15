import { createApp, createError, defineEventHandler, readRawBody, toWebHandler } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => ({
  init: vi.fn(),
  callFunction: vi.fn(),
}))

vi.mock('@cloudbase/js-sdk', () => ({ default: { init: sdk.init } }))
vi.mock('h3', async (importOriginal) => {
  const actual = await importOriginal<typeof import('h3')>()
  return { ...actual, readRawBody: vi.fn(actual.readRawBody) }
})

const development = {
  siteUrl: 'https://www.yunle.localhost:3000',
  cloudbaseEnvId: 'yunlefun-dev-0ge03bdod37093d1',
  cloudbaseRegion: 'ap-shanghai',
  cloudbaseAccessKey: 'fixture-development-publishable-key',
}
let publicConfig = { ...development }

vi.mock('#imports', () => ({ useRuntimeConfig: () => ({ public: publicConfig }) }))
vi.mock('#app/nuxt', () => ({ useRuntimeConfig: () => ({ public: publicConfig }) }))
vi.stubGlobal('defineEventHandler', defineEventHandler)
vi.stubGlobal('createError', createError)
vi.stubGlobal('useRuntimeConfig', () => ({ public: publicConfig }))

const { default: handler } = await import('../../server/api/sso-ticket')
const request = toWebHandler(createApp().use('/api/sso-ticket', handler))
const jwks = { keys: [{ kty: 'OKP', crv: 'Ed25519', kid: 'development-fixture', x: 'fixture-public-key', use: 'sig' }] }

describe('development SSO ticket proxy', () => {
  beforeEach(() => {
    publicConfig = { ...development }
    sdk.init.mockReset().mockReturnValue({ callFunction: sdk.callFunction })
    sdk.callFunction.mockReset().mockResolvedValue({
      result: {
        statusCode: 200,
        headers: {
          'content-type': 'application/jwk-set+json',
          'cache-control': 'public, max-age=300',
          'set-cookie': 'upstream-secret=value',
          'x-provider-secret': 'must-not-leave-proxy',
        },
        body: JSON.stringify(jwks),
      },
    })
    vi.mocked(readRawBody).mockClear()
  })

  it('returns public JWKS through a GET to the same development tenant without reading a body', async () => {
    const response = await request(new Request(`${development.siteUrl}/api/sso-ticket?action=mintForTestLease`, {
      headers: { authorization: 'Bearer fixture-token', cookie: 'fixture-session=value' },
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(jwks)
    expect(response.headers.get('content-type')).toBe('application/jwk-set+json')
    expect(response.headers.get('cache-control')).toBe('public, max-age=300')
    expect(response.headers.has('set-cookie')).toBe(false)
    expect(response.headers.has('x-provider-secret')).toBe(false)
    expect(sdk.init).toHaveBeenCalledExactlyOnceWith({
      env: development.cloudbaseEnvId,
      region: development.cloudbaseRegion,
      accessKey: development.cloudbaseAccessKey,
    })
    expect(sdk.callFunction).toHaveBeenCalledExactlyOnceWith({
      name: 'sso-ticket',
      data: {
        httpMethod: 'GET',
        headers: { 'content-type': '', 'origin': '', 'x-forwarded-proto': 'https' },
        body: '',
        requestContext: { http: { sourceIp: 'unknown' } },
      },
    })
    expect(readRawBody).not.toHaveBeenCalled()
  })

  it('preserves POST exchange status, payload and allowed headers without forwarding credentials', async () => {
    const body = JSON.stringify({ action: 'exchangeSsoCode', code: 'fixture-code', nonce: 'fixture-nonce' })
    const result = { ok: false, reason: 'code_used' }
    sdk.callFunction.mockResolvedValue({
      result: {
        statusCode: 409,
        headers: {
          'content-type': 'application/json',
          'Cache-Control': 'no-store',
          'pragma': 'no-cache',
          'referrer-policy': 'no-referrer',
          'vary': 'Origin',
          'set-cookie': 'upstream-secret=value',
          'authorization': 'Bearer upstream-secret',
          'x-provider-secret': 'must-not-leave-proxy',
        },
        body: JSON.stringify(result),
      },
    })

    const response = await request(new Request(`${development.siteUrl}/api/sso-ticket`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'origin': 'https://cook.yunle.localhost:3455',
        'authorization': 'Bearer fixture-token',
        'cookie': 'fixture-session=value',
        'x-forwarded-for': '192.0.2.1',
      },
      body,
    }))

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual(result)
    expect(sdk.callFunction).toHaveBeenCalledExactlyOnceWith({
      name: 'sso-ticket',
      data: {
        httpMethod: 'POST',
        headers: { 'content-type': 'application/json', 'origin': 'https://cook.yunle.localhost:3455', 'x-forwarded-proto': 'https' },
        body,
        requestContext: { http: { sourceIp: '192.0.2.1' } },
      },
    })
    expect(readRawBody).toHaveBeenCalledExactlyOnceWith(expect.anything(), 'utf8')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('pragma')).toBe('no-cache')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('vary')).toBe('Origin')
    expect(response.headers.has('set-cookie')).toBe(false)
    expect(response.headers.has('authorization')).toBe(false)
    expect(response.headers.has('x-provider-secret')).toBe(false)
  })

  it('preserves OPTIONS preflight status and CORS headers without reading a body', async () => {
    const headers = {
      'access-control-allow-origin': 'https://cook.yunle.localhost:3455',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '600',
    }
    sdk.callFunction.mockResolvedValue({ result: { statusCode: 204, headers } })

    const response = await request(new Request(`${development.siteUrl}/api/sso-ticket`, {
      method: 'OPTIONS',
      headers: { origin: headers['access-control-allow-origin'] },
    }))

    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    for (const [name, value] of Object.entries(headers))
      expect(response.headers.get(name)).toBe(value)
    expect(sdk.callFunction.mock.calls[0]?.[0].data).toMatchObject({ httpMethod: 'OPTIONS', body: '' })
    expect(readRawBody).not.toHaveBeenCalled()
  })

  describe.each(['GET', 'POST', 'OPTIONS'])('%s configuration hardlock', (method) => {
    it.each([
      { name: 'production', siteUrl: 'https://www.yunle.fun', cloudbaseEnvId: 'yunlefun-8g7ybcxc7345c490' },
      { name: 'production tenant behind the development origin', cloudbaseEnvId: 'yunlefun-8g7ybcxc7345c490' },
      { name: 'unregistered provider origin', siteUrl: 'https://preview.example.test' },
      { name: 'missing development publishable key', cloudbaseAccessKey: '' },
    ])('returns 404 before SDK initialization for $name', async ({ name: _name, ...overrides }) => {
      publicConfig = { ...development, ...overrides }

      const response = await request(new Request(`${development.siteUrl}/api/sso-ticket`, { method }))

      expect(response.status).toBe(404)
      expect(sdk.init).not.toHaveBeenCalled()
      expect(sdk.callFunction).not.toHaveBeenCalled()
      expect(readRawBody).not.toHaveBeenCalled()
    })
  })

  it.each(['HEAD', 'PUT', 'PATCH', 'DELETE'])('returns 405 before SDK initialization for %s', async (method) => {
    const response = await request(new Request(`${development.siteUrl}/api/sso-ticket`, { method }))

    expect(response.status).toBe(405)
    expect(sdk.init).not.toHaveBeenCalled()
    expect(sdk.callFunction).not.toHaveBeenCalled()
  })

  it.each([
    { code: 'FUNCTION_INVOCATION_FAILED', message: 'private-provider-error' },
    { result: { statusCode: '200', body: 'private-provider-error' } },
  ])('returns a generic 502 for invalid invocation responses', async (invocation) => {
    sdk.callFunction.mockResolvedValue(invocation)

    const response = await request(new Request(`${development.siteUrl}/api/sso-ticket`, { method: 'POST' }))

    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('private-provider-error')
  })
})
