import { Buffer } from 'node:buffer'
import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { createCookWeChatBindingStore, handleCookWeChat } = require('../../cloudfunctions/sso-ticket/cook-mobile-wechat.js')
const { createCookSignupAuth, handleCookWeChatSignup, lookupCookSignupPhone } = require('../../cloudfunctions/sso-ticket/cook-wechat-signup.js')
const { SsoRateLimitError } = require('../../cloudfunctions/sso-ticket/sso-rate-limit.js')

const request = { origin: 'https://cook.yunyoujun.cn', deviceId: 'device-a', ip: '192.0.2.1', authorization: '' }
const clientId = 'cook-mobile'
const phone = '13900000000'
const fullPhone = `+86 ${phone}`
const uid = 'new-account-uid'

function database() {
  const records = new Map()
  let queue = Promise.resolve()
  return {
    records,
    runTransaction(callback) {
      const next = queue.then(async () => {
        const stage = new Map(records)
        const result = await callback({
          collection: name => ({
            doc(id) {
              const key = `${name}:${id}`
              return {
                get: async () => ({ data: stage.has(key) ? [stage.get(key)] : [] }),
                set: async (value) => {
                  stage.set(key, value)
                  return {}
                },
              }
            },
          }),
        })
        records.clear()
        for (const [key, value] of stage)
          records.set(key, value)
        return result
      })
      queue = next.catch(() => {})
      return next
    },
  }
}

function setup() {
  const db = database()
  const claimed = new Set()
  const auth = {
    getCaptcha: vi.fn(async () => ({ type: 'image', data: 'data:image/gif;base64,R0lGODlh', token: 'image-challenge', expires_in: 300 })),
    verifyCaptcha: vi.fn(async () => ({ captcha_token: 'passed-image' })),
    sendSms: vi.fn(async () => ({ verification_id: 'provider-sms-challenge', expires_in: 600 })),
    verifySms: vi.fn(async id => ({ verification_token: `verified:${id}`, expires_in: 600 })),
    signup: vi.fn(async () => ({ sub: uid, access_token: 'temporary-provider-access' })),
    revokeSession: vi.fn(async () => {}),
  }
  const deps = {
    enabled: true,
    signupEnabled: true,
    signingReady: () => true,
    appSecret: 'b'.repeat(32),
    bindingKey: Buffer.alloc(32, 4),
    authorizeClient: () => ({ appId: 'cook', clientId }),
    rateLimit: async () => {},
    claimCode: async (key) => {
      if (claimed.has(key))
        throw new SsoRateLimitError()
      claimed.add(key)
    },
    signupAuth: () => auth,
    phoneExists: vi.fn(async () => false),
    exchangeCode: vi.fn(async () => 'wechat-identity'),
    currentAccount: vi.fn(async () => ({ sub: uid, phone_number: fullPhone })),
    loadAccount: vi.fn(async () => ({ sub: uid, phone_number: fullPhone })),
    requireAdmission: vi.fn(async () => {}),
    mintTicket: vi.fn(async subject => ({ ok: true, ticket: `ticket-for-${subject}` })),
    bindings: createCookWeChatBindingStore(db),
  }
  const call = (action, fields = {}, req = request) => handleCookWeChatSignup({ action, clientId, ...fields }, req, deps)
  const start = () => call('sendCookSignupSms', { phone })
  const verify = challenge => call('verifyCookSignupSms', { challenge, otp: '123456' })
  return { auth, db, deps, call, start, verify }
}

describe('explicit Cook WeChat signup', () => {
  it('does not reveal or create an existing account before or after verifying its phone', async () => {
    const { auth, deps, start, verify } = setup()
    auth.sendSms.mockResolvedValueOnce({ verification_id: 'provider-sms-challenge', expires_in: 600, is_user: true })
    const sent = await start()
    expect(Object.keys(sent.body)).toEqual(['ok', 'challenge'])
    expect(JSON.stringify(sent)).not.toContain(phone)
    expect(deps.phoneExists).not.toHaveBeenCalled()
    expect(await verify(sent.body.challenge)).toEqual({ status: 200, body: { ok: true, next: 'existing' } })
    expect(auth.verifySms).toHaveBeenCalledOnce()
    expect(auth.signup).not.toHaveBeenCalled()
    expect(deps.mintTicket).not.toHaveBeenCalled()
  })

  it('does not send a text until a required image challenge is verified', async () => {
    const { auth, call } = setup()
    const result = await call('cookSignupCaptcha')
    expect(result.body.image).toBe('data:image/gif;base64,R0lGODlh')
    const captchaChallenge = result.body.challenge
    const fields = { phone, captchaChallenge, captchaAnswer: 'X42B' }
    expect((await call('sendCookSignupSms', fields, { ...request, deviceId: 'other' })).body.reason).toBe('signup_restart_required')
    expect(auth.sendSms).not.toHaveBeenCalled()
    expect((await call('sendCookSignupSms', fields)).status).toBe(200)
    expect(auth.verifyCaptcha).toHaveBeenCalledExactlyOnceWith('image-challenge', 'X42B', request.deviceId)
    expect(auth.sendSms).toHaveBeenCalledExactlyOnceWith(fullPhone, request.deviceId, 'passed-image')
  })

  it('requires a verified phone and explicit confirmation, then binds the created UID and uses it for WeChat login', async () => {
    const { auth, db, deps, call, start, verify } = setup()
    const sent = await start()
    const verified = await verify(sent.body.challenge)
    expect(verified.body.next).toBe('confirm')
    expect(JSON.stringify(verified)).not.toContain('verified:provider-sms-challenge')
    expect(auth.signup).not.toHaveBeenCalled()
    expect(await call('registerCookWeChat', { proof: verified.body.proof, code: 'registration-code' })).toEqual({
      status: 200,
      body: { ok: true, subject: uid, ticket: `ticket-for-${uid}` },
    })
    expect(auth.signup).toHaveBeenCalledExactlyOnceWith(fullPhone, 'verified:provider-sms-challenge', request.deviceId)
    expect(auth.revokeSession).toHaveBeenCalledExactlyOnceWith('temporary-provider-access', request.deviceId)
    expect([...db.records.values()].filter(record => record.uid === uid)).toHaveLength(2)
    const login = await handleCookWeChat({ action: 'exchangeCookWeChatCode', clientId, code: 'login-code' }, request, deps)
    expect(login.body.subject).toBe(uid)
    expect(auth.signup).toHaveBeenCalledTimes(1)
  })

  it('rejects forged proofs, a different device, and a phone that became registered during confirmation', async () => {
    const { auth, deps, call, start, verify } = setup()
    const { body: { challenge } } = await start()
    const { body: { proof } } = await verify(challenge)
    expect((await call('registerCookWeChat', { proof: 'not-a-proof', code: 'registration-code' })).body.reason).toBe('signup_restart_required')
    expect((await call('registerCookWeChat', { proof, code: 'registration-code' }, { ...request, deviceId: 'other' })).body.reason).toBe('signup_restart_required')
    deps.phoneExists.mockResolvedValueOnce(true)
    expect((await call('registerCookWeChat', { proof, code: 'registration-code' })).body.reason).toBe('signup_existing_account')
    expect(deps.exchangeCode).not.toHaveBeenCalled()
    expect(auth.signup).not.toHaveBeenCalled()
  })

  it('does not create two phone accounts for the same concurrently authorized WeChat identity', async () => {
    const { auth, call, start, verify } = setup()
    const { body: { challenge } } = await start()
    const { body: { proof } } = await verify(challenge)
    auth.sendSms.mockResolvedValueOnce({ verification_id: 'another-sms-challenge', expires_in: 600 })
    const secondSms = await call('sendCookSignupSms', { phone: '13900000001' })
    const second = await verify(secondSms.body.challenge)
    const results = await Promise.all([
      call('registerCookWeChat', { proof, code: 'first-code' }),
      call('registerCookWeChat', { proof: second.body.proof, code: 'second-code' }),
    ])
    expect(results.map(result => result.status).sort()).toEqual([200, 409])
    expect(auth.signup).toHaveBeenCalledOnce()
  })

  it('does not create two accounts when a verified phone proof is replayed with different WeChat identities', async () => {
    const { auth, deps, call, start, verify } = setup()
    deps.exchangeCode.mockImplementation(async code => code)
    const { body: { challenge } } = await start()
    const { body: { proof } } = await verify(challenge)
    const results = await Promise.all([
      call('registerCookWeChat', { proof, code: 'wechat-one' }),
      call('registerCookWeChat', { proof, code: 'wechat-two' }),
    ])
    expect(results.map(result => result.status).sort()).toEqual([200, 429])
    expect(auth.signup).toHaveBeenCalledOnce()
  })

  it('preserves the new phone account and stops ticket issuance if the verified profile cannot be bound', async () => {
    const { auth, deps, call, start, verify } = setup()
    const { body: { challenge } } = await start()
    const { body: { proof } } = await verify(challenge)
    deps.currentAccount.mockResolvedValueOnce({ sub: 'wrong-uid', phone_number: fullPhone })
    expect((await call('registerCookWeChat', { proof, code: 'registration-code' })).body.reason).toBe('signup_account_created')
    expect(deps.mintTicket).not.toHaveBeenCalled()
    expect(auth.revokeSession).toHaveBeenCalledOnce()
  })

  it('keeps the registration gate independent from ordinary WeChat login', async () => {
    const { auth, deps, start } = setup()
    deps.signupEnabled = false
    expect((await start()).body.reason).toBe('not_configured')
    const login = await handleCookWeChat({ action: 'exchangeCookWeChatCode', clientId, code: 'login-code' }, request, deps)
    expect(login.body.reason).toBe('wechat_binding_required')
    expect(auth.sendSms).not.toHaveBeenCalled()
    expect(auth.signup).not.toHaveBeenCalled()
  })

  it('uses explicit CloudBase signup and preserves its duplicate-phone rejection', async () => {
    const transport = vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ error: 'phone_exists' }) }))
    const auth = createCookSignupAuth('https://qa.api.tcloudbasegateway.com/auth/v1/user/me', transport)
    await expect(auth.signup(fullPhone, 'phone-proof', request.deviceId)).rejects.toMatchObject({ reason: 'signup_existing_account' })
    const [url, options] = transport.mock.calls[0]
    expect(url.href).toBe('https://qa.api.tcloudbasegateway.com/auth/v1/signup')
    expect(JSON.parse(options.body)).toEqual({ phone_number: fullPhone, verification_token: 'phone-proof' })
    expect(options.redirect).toBe('error')
  })

  it('does not interpret lookup outages or malformed records as a new user', async () => {
    const auth = { queryUserInfo: vi.fn().mockResolvedValueOnce({ code: 'permission_denied' }).mockResolvedValueOnce({ code: 'user_not_found' }).mockResolvedValueOnce({ userInfo: { uid } }) }
    await expect(lookupCookSignupPhone(auth, fullPhone)).rejects.toMatchObject({ reason: 'identity_unavailable' })
    await expect(lookupCookSignupPhone(auth, fullPhone)).resolves.toBe(false)
    await expect(lookupCookSignupPhone(auth, fullPhone)).resolves.toBe(true)
  })
})
