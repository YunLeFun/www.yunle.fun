'use strict'

const { createHash, timingSafeEqual } = require('node:crypto')
const { AuthorizationError } = require('@yunlefun/authorization-core')
const { reserveProof } = require('./proof-store')
const { DEVICES_COLLECTION, isAnonUid } = require('./validation')

const AI_SCOPE = 'ai:writing'

function hash(value, encoding = 'base64url') {
  return createHash('sha256').update(value).digest(encoding)
}

/** Internal Runtime introspection. No CloudBase bearer token is minted. */
async function authorizeAiRequest(db, input, options) {
  const secret = options.serviceToken
  if (typeof secret !== 'string' || secret.length < 32 || /\s/.test(secret)
    || typeof input.serviceToken !== 'string' || input.serviceToken.length > 256
    || !timingSafeEqual(createHash('sha256').update(secret).digest(), createHash('sha256').update(input.serviceToken).digest())) {
    throw new AuthorizationError('runtime_service_denied')
  }
  const now = options.now ?? Date.now()
  const origin = new URL(options.canonicalOrigin)
  if (origin.protocol !== 'https:' || origin.origin !== options.canonicalOrigin)
    throw new AuthorizationError('runtime_unavailable')
  // POST-only RPC keeps the signed request envelope independent of JSON key order.
  const route = {
    '/ai/v1/mobile/writing': { clientId: 'cms-ios', appId: 'cms', scope: AI_SCOPE },
    '/ai/v1/desktop/writing': { clientId: 'cms-desktop', appId: 'cms', scope: AI_SCOPE },
    '/ai/v1/el-bot/agent': { clientId: 'el-bot-cloud', appId: 'el-bot', scope: 'ai:agent' },
  }[input.path]
  const clientId = route?.clientId
  if (input.method !== 'POST' || !clientId
    || typeof input.entitlement !== 'string' || input.entitlement.length > 32_000
    || typeof input.proof !== 'string' || input.proof.length > 8_000
    || typeof input.requestHash !== 'string' || !/^[\w-]{43}$/.test(input.requestHash)) {
    throw new AuthorizationError('invalid_request')
  }
  const proof = options.proofVerifier.verify(input.proof, {
    method: input.method,
    url: `${origin.origin}${input.path}`,
    accessTokenHash: hash(input.entitlement),
    requestHash: input.requestHash,
    now,
  })
  const claims = options.keyring.verifyEntitlement(input.entitlement, {
    audience: clientId,
    deviceJkt: proof.jkt,
    now,
    clockSkewSeconds: 0,
  })
  if (claims.app_id !== route.appId || isAnonUid(claims.sub) || claims.sub.length > 256
    || !Array.isArray(claims.scope) || !claims.scope.includes(route.scope)
    || typeof claims.grant_id !== 'string' || !claims.grant_id || claims.grant_id.length > 128
    || !Number.isSafeInteger(claims.iat) || claims.iat > Math.floor(now / 1000)
    || !Number.isSafeInteger(claims.exp) || claims.exp <= claims.iat || claims.exp - claims.iat > 7 * 24 * 3600) {
    throw new AuthorizationError('ai_scope_required')
  }
  const id = hash(`${claims.sub}\u0000${clientId}\u0000${proof.jkt}`, 'hex')
  const { data } = await db.collection(DEVICES_COLLECTION).doc(id).get()
  const device = Array.isArray(data) ? data[0] : data
  if (!device || device.status !== 'active' || device.revokedAt
    || device.uid !== claims.sub || device.issuer !== claims.iss
    || device.clientId !== clientId || device.appId !== route.appId
    || device.deviceId !== proof.jkt || device.deviceJkt !== proof.jkt
    || device.grantId !== claims.grant_id
    || !Array.isArray(device.scopes) || !device.scopes.includes(route.scope)
    || claims.scope.some(scope => !device.scopes.includes(scope))) {
    throw new AuthorizationError('grant_revoked')
  }
  options.registry.reauthorize(device)
  await options.assertActiveAccount(claims.sub)
  await reserveProof(db, proof, { now })
  return { uid: claims.sub, clientId, appId: route.appId, deviceJkt: proof.jkt, grantId: device.grantId, scope: route.scope }
}

module.exports = { AI_SCOPE, authorizeAiRequest }
