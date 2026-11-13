'use strict'

const { createHash, createHmac } = require('node:crypto')
const { isValidTicketUid } = require('./mint')
const { SSO_RATE_LIMIT_COLLECTION, SsoRateLimitError } = require('./sso-rate-limit')

const COOK_APP_ID = 'wxce6c7405dd756b9d'
const COOK_ORIGIN = 'https://cook.yunyoujun.cn'
const COLLECTION = 'sso_cook_wechat_bindings'
const ACTIONS = new Set(['bindCookWeChat', 'exchangeCookWeChatCode'])
const WECHAT_IDENTIFIER = /^[\w-]{1,128}$/
const CODE = /^[\w-]{1,512}$/
const BEARER = /^Bearer [\w.~+/-]{1,8190}={0,2}$/i

class WeChatSsoError extends Error {
  constructor(reason, status) {
    super(reason)
    this.reason = reason
    this.status = status
  }
}

function fail(reason, status) {
  throw new WeChatSsoError(reason, status)
}

function requireActiveProfile(profile, expectedUid) {
  if (!profile || profile.is_anonymous === true || profile.isAnonymous === true
    || profile.type === 'anonymous' || profile.user_type === 'anonymous'
    || (profile.status != null && !['DEFAULT', 'ACTIVE'].includes(String(profile.status).toUpperCase()))) {
    fail('account_restricted', 403)
  }
  const ids = [profile.uid, profile.sub, profile.user_id].filter(id => id != null && id !== '')
  if (!ids.length || !isValidTicketUid(ids[0]) || !ids.every(id => id === ids[0])
    || (expectedUid && ids[0] !== expectedUid)) {
    fail('identity_unavailable', 503)
  }
  return ids[0]
}

function bindingKey(kind, value) {
  return createHash('sha256').update(`cook-mobile-wechat/v1\0${kind}\0${value}`).digest('hex')
}

function hashUnionId(unionId, bindingKey) {
  return createHmac('sha256', bindingKey).update(`cook-mobile-wechat/v1\0unionid\0${unionId}`).digest('hex')
}

function checkedDocument(result) {
  if (!result || (result.code != null && result.code !== 0 && result.code !== '0'))
    fail('identity_unavailable', 503)
  if (Array.isArray(result.data))
    return result.data[0] || null
  return result.data && Object.keys(result.data).length ? result.data : null
}

function checkedBinding(record, kind) {
  if (!record)
    return null
  if (record.kind !== kind || !isValidTicketUid(record.uid)
    || !/^[a-f0-9]{64}$/.test(record.identityKey)) {
    fail('identity_unavailable', 503)
  }
  return record
}

function createCookWeChatBindingStore(db) {
  const identityRef = (tx, key) => tx.collection(COLLECTION).doc(key)
  const accountRef = (tx, uid) => tx.collection(COLLECTION).doc(bindingKey('uid', uid))
  const signupRef = (tx, key) => tx.collection(SSO_RATE_LIMIT_COLLECTION).doc(bindingKey('signup', key))
  const activeSignup = record => record?.kind === 'signup' && record.lockUntil > Date.now()
  return {
    async reserveSignup(identityKey, attempt, lockUntil) {
      return db.runTransaction(async (tx) => {
        const reservation = signupRef(tx, identityKey)
        const existing = checkedBinding(checkedDocument(await identityRef(tx, identityKey).get()), 'identity')
        const lock = checkedDocument(await reservation.get())
        if (existing || activeSignup(lock))
          fail('binding_conflict', 409)
        const result = await reservation.set({ kind: 'signup', attempt, lockUntil, expiresAt: lockUntil + 86_400_000 })
        if (!result || (result.code != null && result.code !== 0 && result.code !== '0'))
          fail('identity_unavailable', 503)
      })
    },
    async releaseSignup(identityKey, attempt) {
      await db.runTransaction(async (tx) => {
        const ref = signupRef(tx, identityKey)
        const lock = checkedDocument(await ref.get())
        if (lock?.kind !== 'signup' || lock.attempt !== attempt)
          return
        const result = await ref.set({ kind: 'signup-released', expiresAt: Date.now() + 86_400_000 })
        if (!result || (result.code != null && result.code !== 0 && result.code !== '0'))
          fail('identity_unavailable', 503)
      })
    },
    async lookup(identityKey) {
      return db.runTransaction(async (tx) => {
        const record = checkedBinding(checkedDocument(await identityRef(tx, identityKey).get()), 'identity')
        if (!record)
          return null
        const account = checkedBinding(checkedDocument(await accountRef(tx, record.uid).get()), 'uid')
        if (!account || account.identityKey !== identityKey || account.uid !== record.uid || record.identityKey !== identityKey)
          fail('identity_unavailable', 503)
        return record.uid
      })
    },
    async bind(uid, identityKey, signupAttempt) {
      await db.runTransaction(async (tx) => {
        const identity = identityRef(tx, identityKey)
        const account = accountRef(tx, uid)
        const reservation = signupRef(tx, identityKey)
        const lock = checkedDocument(await reservation.get())
        if (signupAttempt ? !activeSignup(lock) || lock.attempt !== signupAttempt : activeSignup(lock))
          fail('binding_conflict', 409)
        const byIdentity = checkedBinding(checkedDocument(await identity.get()), 'identity')
        const byAccount = checkedBinding(checkedDocument(await account.get()), 'uid')
        if ((byIdentity && byIdentity.uid !== uid) || (byAccount && byAccount.identityKey !== identityKey))
          fail('binding_conflict', 409)
        if (byIdentity || byAccount) {
          if (!byIdentity || !byAccount || byIdentity.identityKey !== identityKey || byAccount.uid !== uid)
            fail('identity_unavailable', 503)
          return
        }
        const createdAt = Date.now()
        for (const [ref, kind] of [[identity, 'identity'], [account, 'uid']]) {
          const result = await ref.set({ kind, uid, identityKey, createdAt })
          if (!result || (result.code != null && result.code !== 0 && result.code !== '0'))
            fail('identity_unavailable', 503)
        }
        // A direct bind and signup reservation both write this document so they
        // cannot commit from the same empty snapshot. The sweeper removes it.
        const result = await reservation.set({ kind: 'signup-completed', expiresAt: Date.now() + 86_400_000 })
        if (!result || (result.code != null && result.code !== 0 && result.code !== '0'))
          fail('identity_unavailable', 503)
      })
    },
  }
}

async function exchangeWeChatCode(code, appSecret, fetcher = globalThis.fetch) {
  const url = new URL('https://api.weixin.qq.com/sns/oauth2/access_token')
  url.search = new URLSearchParams({ appid: COOK_APP_ID, secret: appSecret, code, grant_type: 'authorization_code' })
  let response
  let identity
  try {
    response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(3000) })
    if (!response.ok)
      fail('identity_unavailable', 503)
    identity = await response.json()
  }
  catch {
    // Never propagate a fetch error that could include the request URL.
    fail('identity_unavailable', 503)
  }
  if ([40029, 40163, 42001].includes(identity?.errcode))
    fail('wechat_code_invalid', 401)
  if (!identity || (identity.errcode != null && identity.errcode !== 0)
    || typeof identity.openid !== 'string' || !WECHAT_IDENTIFIER.test(identity.openid)
    || typeof identity.scope !== 'string' || !identity.scope.split(',').includes('snsapi_userinfo')) {
    fail('identity_unavailable', 503)
  }
  if (typeof identity.unionid !== 'string' || !WECHAT_IDENTIFIER.test(identity.unionid))
    fail('wechat_identity_unverified', 403)
  return identity.unionid
}

function cookWeChatAccountUrl(context) {
  // Use the same trusted runtime environment as the ticket signer and database.
  const envId = context?.TCB_ENV || context?.SCF_NAMESPACE
  if (typeof envId !== 'string' || !/^[a-z][a-z\d-]{0,47}-[a-z\d]{6,20}$/.test(envId))
    fail('identity_unavailable', 503)
  return `https://${envId}.api.tcloudbasegateway.com/auth/v1/user/me`
}

async function fetchCurrentAccount(authUrl, bearer, deviceId, fetcher = globalThis.fetch) {
  let response
  try {
    response = await fetcher(authUrl, {
      headers: { 'Authorization': bearer, 'Accept': 'application/json', 'x-device-id': deviceId },
      redirect: 'error',
      signal: AbortSignal.timeout(1800),
    })
  }
  catch {
    fail('identity_unavailable', 503)
  }
  if (response.status === 401 || response.status === 403)
    fail('not_authenticated', 401)
  if (!response.ok)
    fail('identity_unavailable', 503)
  return response.json()
}

async function handleCookWeChat(payload, request, deps) {
  try {
    if (!payload || !ACTIONS.has(payload.action) || payload.clientId !== 'cook-mobile'
      || Object.keys(payload).some(key => !['action', 'clientId', 'code'].includes(key))
      || typeof payload.code !== 'string' || !CODE.test(payload.code)) {
      fail('invalid_request', 400)
    }
    if (request.origin !== COOK_ORIGIN)
      fail('origin_not_allowed', 403)
    if (!deps.enabled || !/^[a-f0-9]{32}$/i.test(deps.appSecret || '') || !deps.bindingKey)
      fail('not_configured', 503)
    const client = deps.authorizeClient()
    if (client?.appId !== 'cook' || client.clientId !== 'cook-mobile')
      fail('client_unavailable', 403)
    if (!deps.signingReady())
      fail('not_configured', 503)
    const binding = payload.action === 'bindCookWeChat'
    if (binding && (!BEARER.test(request.authorization) || !/^[\w-]{1,128}$/.test(request.deviceId || '')))
      fail('not_authenticated', 401)
    if (!binding && request.authorization)
      fail('invalid_request', 400)

    await Promise.all([
      deps.rateLimit({ scope: 'cook-wechat-ip', key: request.ip, limit: 20, windowMs: 60_000 }),
      deps.rateLimit({ scope: 'cook-wechat-app', key: 'cook-mobile', limit: 300, windowMs: 60_000 }),
    ])
    const currentUid = binding
      ? requireActiveProfile(await deps.currentAccount(request.authorization, request.deviceId))
      : null
    // A replay must not call WeChat a second time, including on a different runner.
    await deps.claimCode(bindingKey('code', payload.code))
    const unionId = await deps.exchangeCode(payload.code, deps.appSecret)
    const identityKey = hashUnionId(unionId, deps.bindingKey)
    if (binding) {
      // Both proofs are required: the active CloudBase session supplies the UID,
      // and WeChat's exchange supplies the identity. The website provider is independent.
      const latest = await deps.currentAccount(request.authorization, request.deviceId)
      requireActiveProfile(latest, currentUid)
      await deps.requireAdmission(currentUid)
      await deps.bindings.bind(currentUid, identityKey)
      return { status: 200, body: { ok: true } }
    }

    const uid = await deps.bindings.lookup(identityKey)
    if (!uid)
      fail('wechat_binding_required', 404)
    const current = await deps.loadAccount(uid)
    requireActiveProfile(current, uid)
    await deps.requireAdmission(uid)
    const ticket = await deps.mintTicket(uid)
    if (!ticket?.ok || typeof ticket.ticket !== 'string' || !ticket.ticket)
      fail('not_configured', 503)
    return { status: 200, body: { ok: true, ticket: ticket.ticket, subject: uid } }
  }
  catch (error) {
    if (error instanceof WeChatSsoError)
      return { status: error.status, body: { ok: false, reason: error.reason } }
    if (error instanceof SsoRateLimitError)
      return { status: 429, body: { ok: false, reason: 'rate_limited' } }
    if (['account_banned', 'account_deletion_pending', 'account_deletion_finalizing'].includes(error?.code))
      return { status: 403, body: { ok: false, reason: 'account_restricted' } }
    if (error?.reason === 'phone_verification_required')
      return { status: 403, body: { ok: false, reason: 'phone_verification_required' } }
    return { status: 503, body: { ok: false, reason: 'identity_unavailable' } }
  }
}

module.exports = {
  ACTIONS,
  COOK_ORIGIN,
  COLLECTION,
  cookWeChatAccountUrl,
  createCookWeChatBindingStore,
  exchangeWeChatCode,
  fetchCurrentAccount,
  handleCookWeChat,
  WeChatSsoError,
  bindingKey,
  hashUnionId,
  requireActiveProfile,
}
