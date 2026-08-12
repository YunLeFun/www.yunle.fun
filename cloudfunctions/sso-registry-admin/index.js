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
const { verifyAdminApprovalProof } = require('./admin-approval-runtime')
const {
  createApprovalEmailSender,
  createManager,
  createSesClient,
  createStrictApproverResolver,
  loadApprovalRuntimeConfig,
  parseApproverUids,
} = require('./approval-runtime')
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

function loadService(environment = currentEnvironment(), context = {}, action = '') {
  const keyId = String(process.env.SSO_REGISTRY_SIGNING_KID || '').trim()
  const signingKey = decodeKey(process.env.SSO_REGISTRY_SIGNING_KEY)
  if (!keyId || !signingKey)
    throw new Error('SSO Registry signing key is not configured')
  const options = {
    environment,
    keyId,
    signingKey,
    trustAnchors: createTrustAnchors(environment, keyId, signingKey),
    store: createRegistryStore(db),
    randomId: () => randomBytes(12).toString('base64url'),
    verifyAdminApprovalProof,
  }
  if (environment === 'production') {
    options.approverUids = parseApproverUids(process.env.SSO_REGISTRY_APPROVER_UIDS)
    if (['requestPublishApproval', 'approveAndQueueRelease', 'requestRollbackApproval'].includes(action)) {
      const runtime = cloudbase.getCloudbaseContext()
      const envId = runtime.TCB_ENV || runtime.SCF_NAMESPACE
      if (!envId)
        throw new Error('CloudBase environment is unavailable')
      const approvalConfig = loadApprovalRuntimeConfig()
      const manager = createManager(envId, context)
      const sesClient = createSesClient(approvalConfig, context)
      Object.assign(options, {
        approvalPepper: approvalConfig.approvalPepper,
        resolveApproverEmail: createStrictApproverResolver(manager),
        sendApprovalEmail: createApprovalEmailSender(sesClient, approvalConfig),
      })
    }
  }
  return createRegistryAdminService(options)
}

exports.main = async (event, context) => {
  const request = {
    ...(event && typeof event === 'object' ? event : {}),
    requestId: String(context?.requestId || context?.request_id || 'management-invoke'),
  }
  try {
    const environment = currentEnvironment()
    assertRegistryAdminActionAllowed(request.action, environment, {
      ciToken: request.ciToken,
      expectedCiToken: process.env.SSO_REGISTRY_CI_TOKEN,
    })
    const runtime = loadService(environment, context, request.action)
    let data
    switch (request.action) {
      case 'saveDraft':
        data = await runtime.saveDraft(request)
        break
      case 'rebaseDraft':
        data = await runtime.rebaseDraft(request)
        break
      case 'validateDraft':
        data = await runtime.validateDraft(request)
        break
      case 'getDraftDiff':
        data = await runtime.getDraftDiff(request)
        break
      case 'listApprovalDrafts':
        data = await runtime.listApprovalDrafts(request)
        break
      case 'requestPublishApproval':
        data = await runtime.requestPublishApproval(request)
        break
      case 'approveAndQueueRelease':
        data = await runtime.approveAndQueueRelease(request)
        break
      case 'approveAndQueueReleaseByAdmin':
        data = await runtime.approveAndQueueReleaseByAdmin(request)
        break
      case 'requestRollbackApproval':
        data = await runtime.requestRollbackApproval(request)
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
      case 'getReleaseIntent':
        data = await runtime.getReleaseIntent(request)
        break
      case 'recordCiProgress':
        data = await runtime.recordCiProgress(request)
        break
      case 'recordDeploymentResult':
        data = await runtime.recordDeploymentResult(request)
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
