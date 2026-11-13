'use strict'

const { Buffer } = require('node:buffer')
const { createCipheriv, createDecipheriv, createHmac, randomBytes } = require('node:crypto')
const { COOK_ORIGIN, WeChatSsoError, bindingKey, hashUnionId, requireActiveProfile } = require('./cook-mobile-wechat')
const { SsoRateLimitError } = require('./sso-rate-limit')

const ACTIONS = new Set(['cookSignupCaptcha', 'sendCookSignupSms', 'verifyCookSignupSms', 'registerCookWeChat'])
const INPUT = {
  cookSignupCaptcha: [],
  sendCookSignupSms: ['phone', 'captchaChallenge', 'captchaAnswer'],
  verifyCookSignupSms: ['challenge', 'otp'],
  registerCookWeChat: ['proof', 'code'],
}
const PHONE = /^1[3-9]\d{9}$/
const DEVICE = /^[\w-]{1,128}$/
const CODE = /^[\w-]{1,512}$/
const OTP = /^\d{6}$/
const BLOB = /^[\w-]{1,3500}$/
const SIGNUP_SCOPE = 'cook-wechat-signup/v1'
const VERIFY_WINDOW = 600_000
const RESERVATION_WINDOW = 30_000
const ALREADY_REGISTERED = new Set(['phone_exists', 'phone_number_already_exists', 'user_already_exists', 'identity_already_exists', 'already_exists'])
const NOT_FOUND = new Set(['not_found', 'user_not_found'])

function fail(reason, status) {
  throw new WeChatSsoError(reason, status)
}

function boundedString(value, max) {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

function bearer(value) {
  return typeof value === 'string' && /^[\w.~+/-]{1,8190}={0,2}$/.test(value)
}

function seal(key, deviceId, value) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(`${SIGNUP_SCOPE}:\0${deviceId}`))
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url')
}

function open(key, deviceId, blob, kind, now) {
  if (!BLOB.test(blob || ''))
    fail('signup_restart_required', 400)
  try {
    const raw = Buffer.from(blob, 'base64url')
    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12))
    decipher.setAAD(Buffer.from(`${SIGNUP_SCOPE}:\0${deviceId}`))
    decipher.setAuthTag(raw.subarray(12, 28))
    const value = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]))
    if (value.kind === kind && Number.isSafeInteger(value.exp) && value.exp > now)
      return value
  }
  catch {
    // Forged and expired challenges get the same response.
  }
  fail('signup_restart_required', 400)
}

function expiresAt(now, seconds) {
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 3600)
    fail('identity_unavailable', 503)
  return now + Math.min(seconds * 1000, VERIFY_WINDOW)
}

function createCookSignupAuth(accountURL, fetcher = globalThis.fetch) {
  const endpoint = new URL('./', accountURL.replace(/user\/me$/, ''))
  async function post(path, fields, deviceId, extra = {}) {
    let response
    let data
    try {
      response = await fetcher(new URL(path, endpoint), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'x-device-id': deviceId, ...extra },
        body: JSON.stringify(fields),
        redirect: 'error',
        signal: AbortSignal.timeout(3000),
      })
      data = await response.json()
    }
    catch {
      fail('identity_unavailable', 503)
    }
    if (response.ok && !data?.error)
      return data
    const error = data?.error
    if (path === 'verification' && error === 'captcha_required')
      fail('signup_captcha_required', 400)
    if (path === 'captcha/data/verify' && ['invalid_captcha', 'captcha_expired', 'captcha_used'].includes(error))
      fail('signup_captcha_invalid', 400)
    if (path === 'verification/verify' && ['invalid_verification_code', 'invalid_argument', 'verification_expired', 'invalid_verification_id'].includes(error))
      fail('signup_otp_invalid', 400)
    if (path === 'signup' && ALREADY_REGISTERED.has(error))
      fail('signup_existing_account', 409)
    if (path === 'signup' && ['invalid_verification_token', 'verification_token_expired', 'invalid_verification_code', 'captcha_required'].includes(error))
      fail('signup_restart_required', 400)
    if (response.status === 429 || ['resource_exhausted', 'rate_limit_exceeded'].includes(error))
      fail('rate_limited', 429)
    fail('identity_unavailable', 503)
  }

  return {
    getCaptcha: device => post('captcha/data', {}, device),
    verifyCaptcha: (token, key, device) => post('captcha/data/verify', { token, key }, device),
    sendSms: (phone, device, captcha) => post('verification', { phone_number: phone, target: 'ANY' }, device, captcha ? { 'x-captcha-token': captcha } : {}),
    verifySms: (id, code, device) => post('verification/verify', { verification_id: id, verification_code: code }, device),
    signup: (phone, token, device) => post('signup', { phone_number: phone, verification_token: token }, device),
    revokeSession: (token, device) => post('user/signout', {}, device, { Authorization: `Bearer ${token}` }),
  }
}

async function lookupCookSignupPhone(auth, phone) {
  let result
  try {
    result = await auth.queryUserInfo({ platform: 'PHONE', platformId: phone })
  }
  catch (error) {
    if (NOT_FOUND.has(String(error?.code || '').toLowerCase()))
      return false
    throw error
  }
  if (NOT_FOUND.has(String(result?.code || '').toLowerCase()))
    return false
  const user = result?.userInfo
  if (!result || result.code || !user || typeof user !== 'object' || Array.isArray(user))
    fail('identity_unavailable', 503)
  if (Object.keys(user).length === 0 && boundedString(result.requestId, 128))
    return false
  if ([user.uid, user.sub, user.user_id, user.id].some(id => boundedString(id, 128)))
    return true
  fail('identity_unavailable', 503)
}

async function handleCookWeChatSignup(payload, request, deps) {
  try {
    const action = payload?.action
    if (!ACTIONS.has(action) || payload.clientId !== 'cook-mobile'
      || Object.entries(payload).some(([key, value]) => typeof value !== 'string'
        || (key !== 'action' && key !== 'clientId' && !INPUT[action].includes(key)))
      || !DEVICE.test(request.deviceId || '') || request.authorization) {
      fail('invalid_request', 400)
    }
    if (request.origin !== COOK_ORIGIN)
      fail('origin_not_allowed', 403)
    if (!deps.enabled || !deps.signupEnabled || !deps.signingReady() || deps.bindingKey?.length !== 32
      || !/^[a-f0-9]{32}$/i.test(deps.appSecret || '')) {
      fail('not_configured', 503)
    }
    const client = deps.authorizeClient()
    if (client?.appId !== 'cook' || client.clientId !== 'cook-mobile')
      fail('client_unavailable', 403)
    const key = createHmac('sha256', deps.bindingKey).update(SIGNUP_SCOPE).digest()
    const auth = deps.signupAuth()
    const now = Date.now()
    const device = request.deviceId
    const protect = (value, seconds) => seal(key, device, { ...value, exp: expiresAt(now, seconds) })
    await deps.rateLimit({ scope: `cook-signup-${action}`, key: request.ip, limit: 20, windowMs: 60_000 })

    if (action === 'cookSignupCaptcha') {
      const challenge = await auth.getCaptcha(device)
      if (challenge?.type !== 'image' || !boundedString(challenge.token, 1024)
        || !boundedString(challenge.data, 200_000) || !/^data:image\/(?:gif|png|jpeg);base64,[A-Za-z\d+/=]+$/.test(challenge.data)) {
        fail('identity_unavailable', 503)
      }
      return { status: 200, body: { ok: true, image: challenge.data, challenge: protect({ kind: 'captcha', token: challenge.token }, challenge.expires_in) } }
    }
    if (action === 'sendCookSignupSms') {
      if (!PHONE.test(payload.phone || ''))
        fail('invalid_request', 400)
      const phone = `+86 ${payload.phone}`
      let captcha
      if (payload.captchaChallenge || payload.captchaAnswer) {
        if (!/^[A-Z\d]{4,6}$/i.test(payload.captchaAnswer || ''))
          fail('signup_captcha_invalid', 400)
        const c = open(key, device, payload.captchaChallenge, 'captcha', now)
        const verified = await auth.verifyCaptcha(c.token, payload.captchaAnswer, device)
        captcha = verified?.captcha_token
        if (!boundedString(captcha, 2048))
          fail('identity_unavailable', 503)
      }
      await deps.rateLimit({ scope: 'cook-signup-phone', key: createHmac('sha256', key).update(phone).digest('hex'), limit: 5, windowMs: 3600_000 })
      const sent = await auth.sendSms(phone, device, captcha)
      if (!boundedString(sent?.verification_id, 1024) || (sent.is_user !== undefined && typeof sent.is_user !== 'boolean'))
        fail('identity_unavailable', 503)
      return { status: 200, body: { ok: true, challenge: protect({ kind: 'sms', phone, id: sent.verification_id, wasRegistered: sent.is_user === true }, sent.expires_in) } }
    }
    if (action === 'verifyCookSignupSms') {
      if (!OTP.test(payload.otp || ''))
        fail('invalid_request', 400)
      const challenge = open(key, device, payload.challenge, 'sms', now)
      const verified = await auth.verifySms(challenge.id, payload.otp, device)
      if (!boundedString(verified?.verification_token, 1800))
        fail('identity_unavailable', 503)
      if (challenge.wasRegistered || await deps.phoneExists(challenge.phone))
        return { status: 200, body: { ok: true, next: 'existing' } }
      return { status: 200, body: {
        ok: true,
        next: 'confirm',
        proof: protect({ kind: 'proof', phone: challenge.phone, token: verified.verification_token }, verified.expires_in),
      } }
    }

    if (!CODE.test(payload.code || ''))
      fail('invalid_request', 400)
    const proof = open(key, device, payload.proof, 'proof', now)
    if (await deps.phoneExists(proof.phone))
      fail('signup_existing_account', 409)
    await deps.claimCode(bindingKey('code', payload.code))
    const unionId = await deps.exchangeCode(payload.code, deps.appSecret)
    const identityKey = hashUnionId(unionId, deps.bindingKey)
    const attempt = randomBytes(16).toString('hex')
    await deps.bindings.reserveSignup(identityKey, attempt, Date.now() + RESERVATION_WINDOW)
    // CloudBase's explicit signup operation owns phone uniqueness and OTP consumption.
    // Never use the SDK's combined login-or-signup flow here.
    let created
    try {
      // A single verified phone proof can authorize only one signup request,
      // even if another WeChat code arrives concurrently.
      await deps.claimCode(createHmac('sha256', key).update('consumed-phone-proof\0').update(proof.token).digest('hex'))
      created = await auth.signup(proof.phone, proof.token, device)
    }
    catch (error) {
      // A network failure may be ambiguous. Keep its short reservation;
      // a definite duplicate or invalid request can release immediately.
      if (error instanceof SsoRateLimitError || (error instanceof WeChatSsoError && error.status < 500))
        await deps.bindings.releaseSignup(identityKey, attempt)
      throw error
    }
    const uid = created?.sub
    const token = created?.access_token
    let ticket
    try {
      if (!bearer(token) || !boundedString(uid, 128))
        fail('signup_account_created', 503)
      const profile = await deps.currentAccount(`Bearer ${token}`, device)
      requireActiveProfile(profile, uid)
      if (![profile.phone_number, profile.phoneNumber, profile.phone].some(phone => typeof phone === 'string' && phone.replace(/^\+86\s*/, '') === proof.phone.slice(4)))
        fail('signup_account_created', 503)
      await deps.requireAdmission(uid)
      await deps.bindings.bind(uid, identityKey, attempt)
      ticket = await deps.mintTicket(uid)
      if (!ticket?.ok || !boundedString(ticket.ticket, 32768))
        fail('signup_account_created', 503)
    }
    catch {
      // Auth and the document store do not share a transaction. Keep the verified phone
      // account and direct the user to sign in and finish linking if anything failed.
      try {
        await deps.bindings.releaseSignup(identityKey, attempt)
      }
      catch {
        // A stranded reservation expires automatically.
      }
      fail('signup_account_created', 503)
    }
    finally {
      if (bearer(token)) {
        try {
          await auth.revokeSession(token, device)
        }
        catch {
          // The provisional credentials are never exposed to the caller.
        }
      }
    }
    return { status: 200, body: { ok: true, ticket: ticket.ticket, subject: uid } }
  }
  catch (error) {
    if (error instanceof WeChatSsoError)
      return { status: error.status, body: { ok: false, reason: error.reason } }
    if (error instanceof SsoRateLimitError)
      return { status: 429, body: { ok: false, reason: 'rate_limited' } }
    return { status: 503, body: { ok: false, reason: 'identity_unavailable' } }
  }
}

module.exports = { ACTIONS, createCookSignupAuth, lookupCookSignupPhone, handleCookWeChatSignup }
