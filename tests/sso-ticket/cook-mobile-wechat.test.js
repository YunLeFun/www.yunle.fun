import { Buffer } from 'node:buffer'
import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { createCookWeChatBindingStore, exchangeWeChatCode, handleCookWeChat } = require('../../cloudfunctions/sso-ticket/cook-mobile-wechat.js')
const { SsoRateLimitError } = require('../../cloudfunctions/sso-ticket/sso-rate-limit.js')

const uid = 'existing-uid'
const unionId = 'wechat-shared-unionid'
const appSecret = 'a'.repeat(32)
const request = { origin: 'https://cook.yunyoujun.cn', authorization: '', ip: '192.0.2.1' }
const bindingRequest = { ...request, authorization: 'Bearer current-session', deviceId: 'device-1' }
const payload = (action = 'exchangeCookWeChatCode', code = 'wechat-one-time-code') => ({ action, clientId: 'cook-mobile', code })
function websiteProfile(subject = unionId) {
  return {
    sub: uid,
    status: 'ACTIVE',
    providers: [{ id: 'wx_open', provider_user_id: subject }],
  }
}

class FakeDatabase {
  records = new Map()
  queue = Promise.resolve()

  async runTransaction(operation) {
    const previous = this.queue
    let release
    this.queue = new Promise((resolve) => {
      release = resolve
    })
    await previous
    const staged = new Map(this.records)
    try {
      const result = await operation({
        collection: (name) => {
          expect(name).toBe('sso_cook_wechat_bindings')
          return { doc: id => ({
            get: async () => ({ data: staged.has(id) ? [staged.get(id)] : [] }),
            set: async (record) => {
              staged.set(id, record)
              return { updated: 0, upsertedId: id }
            },
          }) }
        },
      })
      this.records = staged
      return result
    }
    finally {
      release()
    }
  }
}

function setup() {
  const db = new FakeDatabase()
  const codes = new Set()
  const deps = {
    enabled: true,
    appSecret,
    bindingKey: Buffer.alloc(32, 9),
    authorizeClient: vi.fn(() => ({ appId: 'cook', clientId: 'cook-mobile' })),
    signingReady: () => true,
    rateLimit: vi.fn(async () => {}),
    claimCode: vi.fn(async (key) => {
      if (codes.has(key))
        throw new SsoRateLimitError()
      codes.add(key)
    }),
    currentAccount: vi.fn(async () => websiteProfile()),
    loadAccount: vi.fn(async () => ({ ...websiteProfile(), uid })),
    requireAdmission: vi.fn(async () => {}),
    exchangeCode: vi.fn(async () => unionId),
    bindings: createCookWeChatBindingStore(db),
    mintTicket: vi.fn(() => ({ ok: true, ticket: 'custom-ticket' })),
  }
  return { db, deps }
}

describe('cook native WeChat through Yunlefun SSO', () => {
  it('binds the authenticated website UID and mints for exactly that UID', async () => {
    const { db, deps } = setup()
    expect(await handleCookWeChat(payload(), request, deps)).toEqual({
      status: 404,
      body: { ok: false, reason: 'wechat_binding_required' },
    })
    expect(deps.mintTicket).not.toHaveBeenCalled()
    expect(await handleCookWeChat(payload('bindCookWeChat', 'binding-code'), bindingRequest, deps)).toEqual({
      status: 200,
      body: { ok: true },
    })
    expect(deps.currentAccount).toHaveBeenCalledWith('Bearer current-session', 'device-1')
    expect(db.records.size).toBe(2)
    expect(JSON.stringify([...db.records])).not.toContain(unionId)
    expect(await handleCookWeChat(payload(undefined, 'new-login-code'), request, deps)).toEqual({
      status: 200,
      body: { ok: true, ticket: 'custom-ticket', subject: uid },
    })
    expect(deps.loadAccount).toHaveBeenCalledWith(uid)
    expect(deps.requireAdmission).toHaveBeenLastCalledWith(uid)
    expect(deps.mintTicket).toHaveBeenCalledExactlyOnceWith(uid)
  })

  it('rejects a different website identity and a binding changed mid-authorization', async () => {
    const { db, deps } = setup()
    deps.currentAccount.mockResolvedValueOnce(websiteProfile()).mockResolvedValueOnce(websiteProfile('other-wechat'))
    const result = await handleCookWeChat(payload('bindCookWeChat'), bindingRequest, deps)
    expect(result).toEqual({ status: 403, body: { ok: false, reason: 'wechat_website_binding_required' } })
    expect(db.records.size).toBe(0)
    expect(deps.mintTicket).not.toHaveBeenCalled()
  })

  it('does not allow another account to claim the same identity or overwrite its own', async () => {
    const { db, deps } = setup()
    const first = 'a'.repeat(64)
    const second = 'b'.repeat(64)
    const outcomes = await Promise.allSettled([
      deps.bindings.bind(uid, first),
      deps.bindings.bind('other-uid', first),
    ])
    expect(outcomes.map(result => result.status)).toEqual(['fulfilled', 'rejected'])
    expect(outcomes[1].reason).toMatchObject({ reason: 'binding_conflict' })
    await expect(deps.bindings.bind(uid, second)).rejects.toMatchObject({ reason: 'binding_conflict' })
    await expect(deps.bindings.bind(uid, first)).resolves.toBeUndefined()
    await expect(deps.bindings.lookup(first)).resolves.toBe(uid)
    expect(db.records.size).toBe(2)
  })

  it('does not sign when the website binding is removed, the UID changes, or admission fails', async () => {
    const { deps } = setup()
    expect((await handleCookWeChat(payload('bindCookWeChat'), bindingRequest, deps)).status).toBe(200)
    deps.loadAccount.mockResolvedValueOnce({ ...websiteProfile(), providers: [] })
    expect((await handleCookWeChat(payload(undefined, 'one'), request, deps)).body.reason).toBe('wechat_website_binding_required')
    deps.loadAccount.mockResolvedValueOnce({ ...websiteProfile(), sub: 'another-uid' })
    expect((await handleCookWeChat(payload(undefined, 'two'), request, deps)).body.reason).toBe('identity_unavailable')
    deps.requireAdmission.mockRejectedValueOnce(Object.assign(new Error('restricted'), { code: 'account_banned' }))
    expect((await handleCookWeChat(payload(undefined, 'three'), request, deps)).body.reason).toBe('account_restricted')
    expect(deps.mintTicket).not.toHaveBeenCalled()
  })

  it('fails closed without configuration, wrong origin or bearer, or caller-supplied identity', async () => {
    const { deps } = setup()
    expect((await handleCookWeChat(payload(), request, { ...deps, enabled: false })).body.reason).toBe('not_configured')
    expect((await handleCookWeChat(payload(), { ...request, origin: 'https://www.yunle.fun' }, deps)).body.reason).toBe('origin_not_allowed')
    expect((await handleCookWeChat(payload('bindCookWeChat'), request, deps)).body.reason).toBe('not_authenticated')
    for (const key of ['uid', 'subject', 'unionid', 'appSecret', 'redirectUri']) {
      expect((await handleCookWeChat({ ...payload(), [key]: 'injected' }, request, deps)).body.reason).toBe('invalid_request')
    }
    expect(deps.exchangeCode).not.toHaveBeenCalled()
  })

  it('does not send a replay to WeChat, even when the first attempt did not sign in', async () => {
    const { deps } = setup()
    expect((await handleCookWeChat(payload(), request, deps)).status).toBe(404)
    expect((await handleCookWeChat(payload(), request, deps)).status).toBe(429)
    expect(deps.exchangeCode).toHaveBeenCalledTimes(1)
    expect(deps.mintTicket).not.toHaveBeenCalled()
  })

  it('exchanges only at the pinned WeChat endpoint and requires a verified UnionID', async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({ openid: 'wechat-app-openid', scope: 'snsapi_userinfo' }),
    }))
    await expect(exchangeWeChatCode('wechat-code', appSecret, fetcher)).rejects.toMatchObject({ reason: 'wechat_identity_unverified' })
    const [url, options] = fetcher.mock.calls[0]
    expect(url.origin + url.pathname).toBe('https://api.weixin.qq.com/sns/oauth2/access_token')
    expect(url.searchParams.get('appid')).toBe('wxce6c7405dd756b9d')
    expect(options.redirect).toBe('error')
    await expect(exchangeWeChatCode('wechat-code', appSecret, async () => {
      throw new Error(`do not leak: ${appSecret}`)
    })).rejects.toThrow(/^identity_unavailable$/)
  })
})
