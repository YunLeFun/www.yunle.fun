import { createHash } from 'node:crypto'
import { createApp, createError, createRouter, defineEventHandler, deleteCookie, getCookie, getHeader, getQuery, getRouterParam, readBody, sendRedirect, setCookie, setHeader, toWebHandler } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const request = 'r'.repeat(43)
const origin = 'https://www.yunle.fun'
const path = '/api/session/cook-handoff'
const config = {
  cookWebHandoffToken: '',
  public: { siteUrl: origin, cloudbaseEnvId: 'yunlefun-8g7ybcxc7345c490', cookieSession: true },
}
const upstream = vi.fn()

vi.mock('#imports', () => ({ useRuntimeConfig: () => config }))
vi.mock('#app/nuxt', () => ({ useRuntimeConfig: () => config }))

for (const [name, value] of Object.entries({
  createError,
  defineEventHandler,
  deleteCookie,
  getCookie,
  getHeader,
  getQuery,
  getRouterParam,
  readBody,
  sendRedirect,
  setCookie,
  useRuntimeConfig: () => config,
  disableSessionResponseCaching: (event: Parameters<typeof setHeader>[0]) => setHeader(event, 'cache-control', 'private, no-store'),
  rateLimit: vi.fn(),
  getUserSession: async () => ({ user: { uid: 'web-account' } }),
  $fetch: { raw: upstream },
})) {
  vi.stubGlobal(name, value)
}

const { default: start } = await import('../../server/api/session/cook-handoff.get')
const { default: redirect } = await import('../../server/api/session/cook-handoff/[request]/[binding].get')
const { default: redeem } = await import('../../server/api/session/cook-handoff.post')
const serve = toWebHandler(createApp().use(createRouter().get(path, start).get(`${path}/:request/:binding`, redirect).post(path, redeem)))

async function browserStart(transport = '') {
  const res = await serve(new Request(`${origin}${path}?request=${request}${transport ? `&transport=${transport}` : ''}`))
  const cookie = res.headers.get('set-cookie')!
  const pair = cookie.split(';')[0]!
  const proof = pair.split('=')[1]!
  return { res, cookie, pair, proof }
}

describe('cook account website handoff endpoints', () => {
  beforeEach(() => {
    config.cookWebHandoffToken = '1'.repeat(64)
    upstream.mockReset()
  })

  it('only advertises availability when configured and keeps the browser proof HttpOnly', async () => {
    const { res, cookie, proof } = await browserStart()
    const binding = createHash('sha256').update(proof).digest('base64url')
    expect(res.status).toBe(303)
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect(res.headers.get('location')).toBe(`${path}/${request}/${binding}`)
    expect(cookie).toContain('__Host-ylf-cook-')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Strict')
    expect(res.headers.get('location')).not.toContain(proof)
    const landing = await serve(new Request(`${origin}${path}/${request}/${binding}`))
    expect(landing.headers.get('location')).toBe(`/auth/cook-account?request=${request}&binding=${binding}`)

    const supported = await serve(new Request(origin + path))
    expect(await supported.json()).toEqual({ supported: true, systemBrowser: true })
    expect(supported.headers.has('set-cookie')).toBe(false)
    config.cookWebHandoffToken = ''
    expect((await serve(new Request(origin + path))).status).toBe(404)
  })

  it('binds a system browser to the existing Cook HTTPS callback without putting the cookie proof in the URL', async () => {
    const { res, cookie, proof } = await browserStart('browser')
    const binding = createHash('sha256').update(proof).digest('base64url')
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe(
      `https://cook.yunyoujun.cn/auth/callback?platform=native#cook_handoff=${request}.${binding}`,
    )
    expect(res.headers.get('location')).not.toContain(proof)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(res.headers.get('cache-control')).toContain('no-store')
    const invalid = await serve(new Request(`${origin}${path}?request=${request}&transport=browser&transport=other`))
    expect(invalid.status).toBe(400)
    expect(invalid.headers.has('set-cookie')).toBe(false)
  })

  it('requires the proof cookie and exact website origin and passes the verified cookie identity on only the private relay', async () => {
    const { pair, proof } = await browserStart()
    const post = (site: string, cookie = '') => serve(new Request(origin + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'origin': site, 'cookie': cookie, 'authorization': 'Bearer browser-token' },
      body: JSON.stringify({ request, cookieSubject: 'attacker-choice', proof: 'attacker-choice' }),
    }))
    expect((await post('https://another.example', pair)).status).toBe(403)
    expect((await post(origin)).status).toBe(410)
    expect(upstream).not.toHaveBeenCalled()
    upstream.mockResolvedValue({ ok: true, _data: { state: 'reuse', subject: 'web-account' } })
    const response = await post(origin, pair)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ state: 'reuse', subject: 'web-account' })
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(upstream).toHaveBeenCalledExactlyOnceWith('https://api.yunle.fun/sso-ticket', expect.objectContaining({
      headers: { 'authorization': 'Bearer browser-token', 'x-cook-handoff-key': config.cookWebHandoffToken },
      body: { action: 'redeemCookWebHandoff', request, proof, cookieSubject: 'web-account', confirmation: '' },
    }))
  })
})
