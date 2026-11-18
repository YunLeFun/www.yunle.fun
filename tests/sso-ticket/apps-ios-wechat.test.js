import { Buffer } from 'node:buffer'
import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { createAppsIOSWeChatStore, handleAppsIOSWeChat } = require('../../cloudfunctions/sso-ticket/apps-ios-wechat.js')

const request = { origin: 'https://apps.yunle.fun', authorization: '', ip: '192.0.2.1' }
const signedIn = { ...request, authorization: 'Bearer fixture-session', deviceId: 'fixture-device' }

function setup(enabled = true) {
  const rows = new Map()
  const database = {
    collection: name => ({ doc: (id) => {
      const key = `${name}/${id}`
      return {
        get: async () => ({ data: rows.has(key) ? [rows.get(key)] : [] }),
        set: async row => ({ updated: Number(rows.set(key, row).has(key)) }),
        remove: async () => ({ deleted: Number(rows.delete(key)) }),
      }
    } }),
    runTransaction: async operation => operation(database),
  }
  rows.set('app_login_options/web', { weChatLoginVisible: true, revision: 1 })
  if (enabled)
    rows.set('app_login_options/ios', { weChatLoginVisible: true, revision: 1 })
  const deps = {
    appSecret: 'a'.repeat(32),
    bindingKey: Buffer.alloc(32, 9),
    store: createAppsIOSWeChatStore(database),
    signingReady: () => true,
    rateLimit: vi.fn(async () => {}),
    claimCode: vi.fn(async () => {}),
    exchangeCode: vi.fn(async () => 'wechat-union-fixture'),
    currentAccount: vi.fn(async () => ({ sub: 'original-uid', status: 'ACTIVE' })),
    loadAccount: vi.fn(async uid => ({ sub: uid, status: 'ACTIVE' })),
    requireAdmission: vi.fn(async () => {}),
    mintTicket: vi.fn(() => ({ ok: true, ticket: 'fixture-ticket' })),
  }
  return { deps, rows, database }
}

describe('native Apps iOS WeChat login', () => {
  it('stays off if only the web switch is enabled or the app secret is absent', async () => {
    const { deps, rows } = setup(false)
    const availability = { action: 'appsIOSWeChatAvailability' }
    expect((await handleAppsIOSWeChat(availability, request, deps)).body.enabled).toBe(false)
    expect((await handleAppsIOSWeChat({ action: 'exchangeAppsIOSWeChatCode', code: 'fixture-code' }, request, deps)).status).toBe(503)
    rows.set('app_login_options/ios', { weChatLoginVisible: true, revision: 1 })
    expect((await handleAppsIOSWeChat(availability, request, { ...deps, appSecret: undefined })).body.enabled).toBe(false)
    expect(deps.exchangeCode).not.toHaveBeenCalled()
  })

  it('does not enable login with a malformed or unreadable Admin setting', async () => {
    const { deps, rows, database } = setup()
    const availability = { action: 'appsIOSWeChatAvailability' }
    rows.set('app_login_options/ios', { weChatLoginVisible: true })
    expect(await handleAppsIOSWeChat(availability, request, deps)).toEqual({ status: 200, body: { ok: true, enabled: false } })

    vi.spyOn(database, 'collection').mockReturnValue({ doc: () => ({ get: async () => ({ code: 'DATABASE_ERROR' }) }) })
    expect(await handleAppsIOSWeChat(availability, request, deps)).toEqual({ status: 200, body: { ok: true, enabled: false } })
    expect((await handleAppsIOSWeChat({ action: 'exchangeAppsIOSWeChatCode', code: 'fixture-code' }, request, deps)).status).toBe(503)
    expect(deps.exchangeCode).not.toHaveBeenCalled()
  })

  it('binds an existing account, signs into its UID, and permits unbinding even when switched off', async () => {
    const { deps, rows } = setup()
    const login = { action: 'exchangeAppsIOSWeChatCode', code: 'fixture-code' }
    expect((await handleAppsIOSWeChat(login, request, deps)).status).toBe(404)
    expect((await handleAppsIOSWeChat({ action: 'bindAppsIOSWeChat', code: 'binding-code' }, request, deps)).status).toBe(401)
    expect((await handleAppsIOSWeChat({ action: 'bindAppsIOSWeChat', code: 'binding-code' }, signedIn, deps)).status).toBe(200)
    expect((await handleAppsIOSWeChat(login, request, deps)).body).toEqual({ ok: true, ticket: 'fixture-ticket', subject: 'original-uid' })
    expect(JSON.stringify([...rows])).not.toContain('wechat-union-fixture')
    expect(deps.mintTicket).toHaveBeenCalledExactlyOnceWith('original-uid')
    rows.delete('app_login_options/ios')
    expect((await handleAppsIOSWeChat({ action: 'unbindAppsIOSWeChat' }, signedIn, deps)).status).toBe(200)
    expect((await handleAppsIOSWeChat({ action: 'appsIOSWeChatStatus' }, signedIn, deps)).body.bound).toBe(false)
  })

  it('does not accept caller-selected accounts or an identity that changes during binding', async () => {
    const { deps } = setup()
    const bind = { action: 'bindAppsIOSWeChat', code: 'fixture-code' }
    expect((await handleAppsIOSWeChat({ ...bind, uid: 'forged-uid' }, signedIn, deps)).status).toBe(400)
    deps.currentAccount.mockResolvedValueOnce({ sub: 'original-uid' }).mockResolvedValueOnce({ sub: 'other-uid' })
    expect((await handleAppsIOSWeChat(bind, signedIn, deps)).status).toBe(503)
    expect(await deps.store.status('original-uid')).toBe(false)
    expect(deps.mintTicket).not.toHaveBeenCalled()
  })
})
