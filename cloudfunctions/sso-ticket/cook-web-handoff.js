'use strict'

const { createHash } = require('node:crypto')
const { COOK_ORIGIN, requireActiveProfile, WeChatSsoError } = require('./cook-mobile-wechat')
const { isValidTicketUid, tokensMatch } = require('./mint')
const { resultDocument, SSO_LOGIN_CODE_COLLECTION } = require('./sso-code-store')
const { SsoRateLimitError } = require('./sso-rate-limit')

const ISSUE = 'approveCookWebHandoff'
const REDEEM = 'redeemCookWebHandoff'
const ACTIONS = new Set([ISSUE, REDEEM])
const TYPE = 'cook_web_handoff_v1'
const TOKEN = /^[\w-]{43}$/
const BEARER = /^Bearer [\w.~+/-]{1,8190}={0,2}$/i
const TTL_MS = 120_000

function digest(input, encoding = 'base64url') {
  return createHash('sha256').update(input, 'utf8').digest(encoding)
}

function documentId(request, binding) {
  return digest(`${TYPE}\0${request}\0${binding}`, 'hex')
}

function checkResult(result, modifying = false) {
  if (!result || (result.code !== undefined && result.code !== 0 && result.code !== '0'))
    throw new Error('handoff storage unavailable')
  const updated = result.updated ?? result.modifiedCount
  if (modifying && updated !== undefined && updated !== 1)
    throw new Error('handoff claim failed')
  return resultDocument(result)
}

function createCookWebHandoffStore(database, now = Date.now) {
  function reference(transaction, id) {
    return transaction.collection(SSO_LOGIN_CODE_COLLECTION).doc(id)
  }

  return {
    async approve(verifier, binding, subject) {
      const id = documentId(digest(verifier), binding)
      return await database.runTransaction(async (tx) => {
        const ref = reference(tx, id)
        if (checkResult(await ref.get()))
          return false
        checkResult(await ref.set({ recordType: TYPE, status: 'approved', subject, expiresAt: now() + TTL_MS }))
        return true
      })
    },

    async redeem(request, proof, browserSubject, cookieSubject, confirmation) {
      const id = documentId(request, digest(proof))
      return await database.runTransaction(async (tx) => {
        const ref = reference(tx, id)
        const record = checkResult(await ref.get())
        if (!record)
          return { state: 'pending' }
        if (record.recordType !== TYPE || record.status !== 'approved'
          || !Number.isSafeInteger(record.expiresAt) || record.expiresAt <= now()
          || !isValidTicketUid(record.subject)) {
          return { state: 'unavailable' }
        }
        const subject = record.subject
        if ([browserSubject, cookieSubject].some(value => value && value !== subject)) {
          // Consent applies only to the exact browser identities observed for this attempt.
          const expected = digest(`${id}\0${browserSubject}\0${cookieSubject}`)
          if (confirmation !== expected)
            return { state: 'switch', confirmation: expected }
        }
        checkResult(await ref.update({ status: 'consumed', consumedAt: now() }), true)
        return { state: browserSubject === subject && (!cookieSubject || cookieSubject === subject) ? 'reuse' : 'issued', subject }
      })
    },
  }
}

async function handleCookWebHandoff(payload, request, deps) {
  const respond = (status, body) => ({ status, body })
  const fail = (status, reason) => respond(status, { ok: false, reason })
  try {
    if (!/^[a-f\d]{64}$/i.test(deps.serviceToken || '') || !deps.signingReady())
      return fail(503, 'not_configured')
    if (payload.action === ISSUE) {
      if (payload.clientId !== 'cook-mobile'
        || Object.keys(payload).some(key => !['action', 'clientId', 'verifier', 'binding'].includes(key))
        || typeof payload.verifier !== 'string' || !TOKEN.test(payload.verifier)
        || typeof payload.binding !== 'string' || !TOKEN.test(payload.binding)) {
        return fail(400, 'invalid_request')
      }
      if (request.origin !== COOK_ORIGIN)
        return fail(403, 'origin_not_allowed')
      if (!BEARER.test(request.authorization) || typeof request.deviceId !== 'string' || !/^[\w-]{1,128}$/.test(request.deviceId))
        return fail(401, 'not_authenticated')
      await deps.rateLimit({ scope: 'cook-web-handoff-ip', key: request.ip, limit: 60, windowMs: 60_000 })
      const registration = deps.authorizeClient()
      if (registration?.appId !== 'cook' || registration.clientId !== 'cook-mobile')
        return fail(403, 'client_unavailable')
      const uid = requireActiveProfile(await deps.currentAccount(request.authorization, request.deviceId))
      await deps.rateLimit({ scope: 'cook-web-handoff-user', key: uid, limit: 10, windowMs: 60_000 })
      await deps.requireAdmission(uid)
      if (!await deps.store.approve(payload.verifier, payload.binding, uid))
        return fail(409, 'handoff_already_approved')
      return respond(200, { ok: true })
    }

    if (payload.action !== REDEEM || !tokensMatch(request.serviceToken, deps.serviceToken))
      return fail(403, 'forbidden')
    if (typeof payload.request !== 'string' || !TOKEN.test(payload.request)
      || typeof payload.proof !== 'string' || !TOKEN.test(payload.proof)
      || (payload.cookieSubject !== '' && !isValidTicketUid(payload.cookieSubject))
      || (payload.confirmation !== '' && (typeof payload.confirmation !== 'string' || !TOKEN.test(payload.confirmation)))) {
      return fail(400, 'invalid_request')
    }
    let browserSubject = ''
    if (request.authorization) {
      if (!BEARER.test(request.authorization))
        return fail(400, 'invalid_request')
      browserSubject = requireActiveProfile(await deps.currentAccount(request.authorization))
    }
    const result = await deps.store.redeem(payload.request, payload.proof, browserSubject, payload.cookieSubject, payload.confirmation)
    if (result.state === 'unavailable')
      return fail(410, 'handoff_expired')
    if (result.state === 'pending' || result.state === 'switch')
      return respond(200, result)
    await deps.requireAdmission(result.subject)
    if (result.state === 'reuse')
      return respond(200, result)
    const minted = await deps.mintTicket(result.subject)
    if (!minted?.ok || !minted.ticket)
      return fail(503, 'not_configured')
    return respond(200, { state: 'issued', subject: result.subject, ticket: minted.ticket })
  }
  catch (error) {
    if (error instanceof SsoRateLimitError)
      return fail(429, 'rate_limited')
    if (error instanceof WeChatSsoError)
      return fail(error.status, error.reason)
    if (['account_banned', 'account_deletion_pending', 'account_deletion_finalizing'].includes(error?.code)
      || error?.reason === 'phone_verification_required') {
      return fail(403, 'account_restricted')
    }
    return fail(503, 'identity_unavailable')
  }
}

module.exports = { ACTIONS, createCookWebHandoffStore, handleCookWebHandoff }
