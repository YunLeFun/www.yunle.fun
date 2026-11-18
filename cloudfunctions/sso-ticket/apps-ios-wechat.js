'use strict'

const { createHash, createHmac } = require('node:crypto')
const { WeChatSsoError, exchangeWeChatCode, requireActiveProfile } = require('./cook-mobile-wechat')
const { isValidTicketUid } = require('./mint')
const { SsoRateLimitError } = require('./sso-rate-limit')

const APP_ID = 'wx925d6e320d64f30a'
const ORIGIN = 'https://apps.yunle.fun'
const COLLECTION = 'sso_apps_ios_wechat_bindings'
const ACTIONS = new Set(['appsIOSWeChatAvailability', 'appsIOSWeChatStatus', 'bindAppsIOSWeChat', 'unbindAppsIOSWeChat', 'exchangeAppsIOSWeChatCode'])
const BEARER = /^Bearer [\w.~+/-]{1,8190}={0,2}$/i
const DIGEST = /^[a-f\d]{64}$/

function fail(reason, status) {
  throw new WeChatSsoError(reason, status)
}

function digest(kind, value) {
  return createHash('sha256').update(`apps-ios-wechat/v1\0${kind}\0${value}`).digest('hex')
}

function checked(result) {
  if (!result || (result.code != null && result.code !== 0 && result.code !== '0'))
    fail('identity_unavailable', 503)
  return result
}

async function read(ref) {
  const { data } = checked(await ref.get())
  const record = Array.isArray(data) ? data[0] : data
  return record && Object.keys(record).length ? record : null
}

async function readBinding(ref, kind) {
  const record = await read(ref)
  if (record && (record.kind !== kind || !isValidTicketUid(record.uid) || !DIGEST.test(record.identityKey)))
    fail('identity_unavailable', 503)
  return record
}

function createAppsIOSWeChatStore(db) {
  const identityRef = (tx, key) => tx.collection(COLLECTION).doc(key)
  const uidRef = (tx, uid) => tx.collection(COLLECTION).doc(digest('uid', uid))

  async function pair(tx, uid, identityKey) {
    const account = uidRef(tx, uid)
    const identity = identityRef(tx, identityKey)
    const owner = await readBinding(identity, 'identity')
    const current = await readBinding(account, 'uid')
    if (owner?.uid !== uid || owner.identityKey !== identityKey || current?.uid !== uid || current.identityKey !== identityKey)
      fail('identity_unavailable', 503)
    return { account, identity }
  }

  return {
    async visible() {
      const options = await read(db.collection('app_login_options').doc('ios'))
      return options?.weChatLoginVisible === true && Number.isSafeInteger(options.revision) && options.revision > 0
    },
    lookup(identityKey) {
      return db.runTransaction(async (tx) => {
        const record = await readBinding(identityRef(tx, identityKey), 'identity')
        if (!record)
          return null
        await pair(tx, record.uid, identityKey)
        return record.uid
      })
    },
    status(uid) {
      return db.runTransaction(async (tx) => {
        const current = await readBinding(uidRef(tx, uid), 'uid')
        if (!current)
          return false
        await pair(tx, uid, current.identityKey)
        return true
      })
    },
    bind(uid, identityKey) {
      return db.runTransaction(async (tx) => {
        const identity = identityRef(tx, identityKey)
        const account = uidRef(tx, uid)
        const owner = await readBinding(identity, 'identity')
        const current = await readBinding(account, 'uid')
        if ((owner && owner.uid !== uid) || (current && current.identityKey !== identityKey))
          fail('binding_conflict', 409)
        if (owner || current) {
          await pair(tx, uid, identityKey)
          return
        }
        const createdAt = Date.now()
        checked(await identity.set({ kind: 'identity', uid, identityKey, createdAt }))
        checked(await account.set({ kind: 'uid', uid, identityKey, createdAt }))
      })
    },
    unbind(uid) {
      return db.runTransaction(async (tx) => {
        const current = await readBinding(uidRef(tx, uid), 'uid')
        if (!current)
          return
        const { account, identity } = await pair(tx, uid, current.identityKey)
        checked(await identity.remove())
        checked(await account.remove())
      })
    },
  }
}

async function available(deps) {
  try {
    return /^[a-f\d]{32}$/i.test(deps.appSecret || '') && deps.bindingKey?.length === 32
      && deps.signingReady() && await deps.store.visible()
  }
  catch {
    return false
  }
}

async function handleAppsIOSWeChat(payload, request, deps) {
  const action = payload?.action
  try {
    if (!ACTIONS.has(action) || request.origin !== ORIGIN)
      fail('origin_not_allowed', 403)
    const needsCode = action === 'bindAppsIOSWeChat' || action === 'exchangeAppsIOSWeChatCode'
    if (Object.keys(payload).some(key => key !== 'action' && !(needsCode && key === 'code'))
      || (needsCode && (typeof payload.code !== 'string' || !/^[\w-]{1,512}$/.test(payload.code)))) {
      fail('invalid_request', 400)
    }
    if (action === 'appsIOSWeChatAvailability')
      return { status: 200, body: { ok: true, enabled: Boolean(await available(deps)) } }
    if (needsCode && !await available(deps))
      fail('not_configured', 503)

    const signedIn = action !== 'exchangeAppsIOSWeChatCode'
    if (signedIn && (!BEARER.test(request.authorization) || !/^[\w-]{1,128}$/.test(request.deviceId || '')))
      fail('not_authenticated', 401)
    if (!signedIn && request.authorization)
      fail('invalid_request', 400)
    await Promise.all([
      deps.rateLimit({ scope: 'apps-ios-wechat-ip', key: request.ip, limit: 20, windowMs: 60_000 }),
      deps.rateLimit({ scope: 'apps-ios-wechat-app', key: 'apps-ios', limit: 300, windowMs: 60_000 }),
    ])
    const uid = signedIn ? requireActiveProfile(await deps.currentAccount(request.authorization, request.deviceId)) : null
    if (action === 'appsIOSWeChatStatus')
      return { status: 200, body: { ok: true, bound: await deps.store.status(uid) } }
    if (action === 'unbindAppsIOSWeChat') {
      await deps.store.unbind(uid)
      return { status: 200, body: { ok: true } }
    }

    await deps.claimCode(digest('code', payload.code))
    const unionId = await deps.exchangeCode(payload.code, deps.appSecret)
    const identityKey = createHmac('sha256', deps.bindingKey).update(`apps-ios-wechat/v1\0${unionId}`).digest('hex')
    if (!await available(deps))
      fail('not_configured', 503)
    if (action === 'bindAppsIOSWeChat') {
      requireActiveProfile(await deps.currentAccount(request.authorization, request.deviceId), uid)
      await deps.requireAdmission(uid)
      await deps.store.bind(uid, identityKey)
      return { status: 200, body: { ok: true } }
    }
    const subject = await deps.store.lookup(identityKey)
    if (!subject)
      fail('wechat_binding_required', 404)
    requireActiveProfile(await deps.loadAccount(subject), subject)
    await deps.requireAdmission(subject)
    const ticket = await deps.mintTicket(subject)
    if (!ticket?.ok || typeof ticket.ticket !== 'string' || !ticket.ticket)
      fail('not_configured', 503)
    return { status: 200, body: { ok: true, ticket: ticket.ticket, subject } }
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

module.exports = { ACTIONS, createAppsIOSWeChatStore, handleAppsIOSWeChat, exchangeAppsIOSWeChatCode: (code, secret) => exchangeWeChatCode(code, secret, globalThis.fetch, APP_ID) }
