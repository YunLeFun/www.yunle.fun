/** Private Event Function for SSO Client Registry publishing and rollback. */

'use strict'

const { Buffer } = require('node:buffer')
const { createPrivateKey, createPublicKey, randomBytes } = require('node:crypto')
const process = require('node:process')
const cloudbase = require('@cloudbase/node-sdk')
const {
  registryTrustAnchors,
} = require('@yunlefun/authorization-core')
const { assertRegistryAdminActionAllowed } = require('./action-policy')
const { RegistryAdminError, createRegistryAdminService } = require('./service')
const { createRegistryStore } = require('./store')

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
const db = app.database()

function decodeKey(raw) {
  const value = String(raw || '').trim()
  if (value.startsWith('{') || value.startsWith('-----'))
    return value
  try {
    const decoded = Buffer.from(value, 'base64').toString('utf8').trim()
    if (decoded.startsWith('{') || decoded.includes('-----'))
      return decoded
  }
  catch {}
  return value
}

function currentEnvironment() {
  if (process.env.AUTH_ISSUER_ENVIRONMENT === 'production' || process.env.AUTH_ISSUER_ENVIRONMENT === 'development')
    return process.env.AUTH_ISSUER_ENVIRONMENT
  throw new Error('AUTH_ISSUER_ENVIRONMENT must be production or development')
}

function createTrustAnchors(environment, keyId, signingKey) {
  const publicJwk = createPublicKey(createPrivateKey(signingKey)).export({ format: 'jwk' })
  return {
    production: { ...registryTrustAnchors.production },
    development: { ...registryTrustAnchors.development },
    [environment]: {
      ...registryTrustAnchors[environment],
      [keyId]: publicJwk,
    },
  }
}

let service
function loadService(environment = currentEnvironment()) {
  if (service)
    return service
  const keyId = String(process.env.SSO_REGISTRY_SIGNING_KID || '').trim()
  const signingKey = decodeKey(process.env.SSO_REGISTRY_SIGNING_KEY)
  if (!keyId || !signingKey)
    throw new Error('SSO Registry signing key is not configured')
  service = createRegistryAdminService({
    environment,
    keyId,
    signingKey,
    trustAnchors: createTrustAnchors(environment, keyId, signingKey),
    store: createRegistryStore(db),
    randomId: () => randomBytes(12).toString('base64url'),
  })
  return service
}

exports.main = async (event, context) => {
  const request = {
    ...(event && typeof event === 'object' ? event : {}),
    requestId: String(context?.requestId || context?.request_id || 'management-invoke'),
  }
  try {
    const environment = currentEnvironment()
    assertRegistryAdminActionAllowed(request.action, environment)
    const runtime = loadService(environment)
    let data
    switch (request.action) {
      case 'saveDraft':
        data = await runtime.saveDraft(request)
        break
      case 'validateDraft':
        data = await runtime.validateDraft(request)
        break
      case 'publishDraft':
        data = await runtime.publishDraft(request)
        break
      case 'rollback':
        data = await runtime.rollback(request)
        break
      case 'getActiveEnvelope':
        data = await runtime.getActiveEnvelope(request)
        break
      case 'getStatus':
        data = await runtime.getStatus(request)
        break
      default:
        throw new RegistryAdminError('unsupported_action')
    }
    return { ok: true, data }
  }
  catch (error) {
    const code = error instanceof RegistryAdminError ? error.code : 'registry_admin_unavailable'
    console.error('[sso-registry-admin] request failed', JSON.stringify({
      action: typeof request.action === 'string' ? request.action : 'unknown',
      code,
      requestId: request.requestId,
    }))
    return { ok: false, error: code }
  }
}

exports._private = { createTrustAnchors, decodeKey, loadService }
