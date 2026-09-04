/** Strict CloudBase Auth lookup and Tencent Cloud SES approval delivery. */

'use strict'

const { Buffer } = require('node:buffer')
const process = require('node:process')
const {
  createRecipientResolver,
  sendTencentEmail,
} = require('@yunlefun/transactional-email')

function parseApproverUids(value) {
  let parsed
  try {
    parsed = JSON.parse(String(value || ''))
  }
  catch {
    throw new Error('SSO_REGISTRY_APPROVER_UIDS must be a JSON array')
  }
  if (!Array.isArray(parsed) || parsed.length === 0
    || parsed.some(uid => typeof uid !== 'string' || !uid || uid.trim() !== uid)
    || new Set(parsed).size !== parsed.length) {
    throw new Error('SSO_REGISTRY_APPROVER_UIDS must contain unique immutable uids')
  }
  return parsed
}

function loadApprovalRuntimeConfig(env = process.env) {
  const approvalPepper = String(env.SSO_REGISTRY_APPROVAL_PEPPER || '')
  if (Buffer.byteLength(approvalPepper, 'utf8') < 32)
    throw new Error('SSO_REGISTRY_APPROVAL_PEPPER must be at least 32 bytes')
  const templateId = Number(env.SES_TEMPLATE_REGISTRY_APPROVAL)
  if (!Number.isSafeInteger(templateId) || templateId <= 0)
    throw new Error('SES_TEMPLATE_REGISTRY_APPROVAL must be a positive template id')
  return {
    approvalPepper,
    approverUids: parseApproverUids(env.SSO_REGISTRY_APPROVER_UIDS),
    region: String(env.SES_REGION || 'ap-guangzhou'),
    fromAddress: String(env.SES_FROM_EMAIL || 'account@notify.yunle.fun'),
    fromName: String(env.SES_FROM_NAME || '云乐坊账号安全'),
    replyTo: String(env.SES_REPLY_TO || 'kf@yunle.fun'),
    templateIds: { registry_approval: templateId },
  }
}

function createStrictApproverResolver(manager, auth) {
  return createRecipientResolver(manager, {
    requireActive: true,
    requireUidMatch: true,
    requireVerified: true,
    verifyEmailIdentity: async ({ email, userId }) => {
      if (!auth || typeof auth.queryUserInfo !== 'function')
        return false
      const response = await auth.queryUserInfo({
        platform: 'EMAIL',
        platformId: email,
      })
      const data = response?.data || response?.Data || response
      const user = data?.userInfo || data?.UserInfo
      const resolvedUid = user?.uid || user?.Uid || user?.userId || user?.UserId
      const resolvedEmail = user?.email || user?.Email
      return resolvedUid === userId
        && typeof resolvedEmail === 'string'
        && resolvedEmail.toLowerCase() === email.toLowerCase()
    },
  })
}

function createApprovalEmailSender(client, config) {
  return message => sendTencentEmail(client, config, {
    id: message.approvalId,
    to: message.to,
    subject: `云乐坊 SSO Registry 发布审批 · ${message.policyVersion}`,
    type: 'registry_approval',
    templateData: {
      approvalId: message.approvalId,
      code: message.code,
      environment: message.environment,
      policyVersion: message.policyVersion,
      clientCount: String(message.clientCount),
      diffSummary: JSON.stringify(message.diffSummary),
      contentHash: message.contentHash.slice(0, 16),
      securityHash: message.securityHash.slice(0, 16),
      requester: message.requester,
      changeReason: message.changeReason,
      expiresAt: new Date(message.expiresAt).toISOString(),
    },
  })
}

function createManager(envId, context = {}) {
  const managerModule = require('@cloudbase/manager-node')
  const CloudBase = managerModule.default || managerModule
  return CloudBase.init({
    envId,
    secretId: context.TENCENTCLOUD_SECRETID || process.env.TENCENTCLOUD_SECRETID,
    secretKey: context.TENCENTCLOUD_SECRETKEY || process.env.TENCENTCLOUD_SECRETKEY,
    token: context.TENCENTCLOUD_SESSIONTOKEN || process.env.TENCENTCLOUD_SESSIONTOKEN,
  })
}

function createSesClient(config, context = {}) {
  const tencentcloud = require('tencentcloud-sdk-nodejs-ses')
  const Client = tencentcloud.ses.v20201002.Client
  const credential = {
    secretId: context.TENCENTCLOUD_SECRETID || process.env.TENCENTCLOUD_SECRETID,
    secretKey: context.TENCENTCLOUD_SECRETKEY || process.env.TENCENTCLOUD_SECRETKEY,
    token: context.TENCENTCLOUD_SESSIONTOKEN || process.env.TENCENTCLOUD_SESSIONTOKEN,
  }
  if (!credential.secretId || !credential.secretKey)
    throw new Error('CloudBase runtime credentials are unavailable')
  return new Client({
    credential,
    region: config.region,
    profile: { httpProfile: { endpoint: 'ses.tencentcloudapi.com' } },
  })
}

module.exports = {
  createApprovalEmailSender,
  createManager,
  createSesClient,
  createStrictApproverResolver,
  loadApprovalRuntimeConfig,
  parseApproverUids,
}
