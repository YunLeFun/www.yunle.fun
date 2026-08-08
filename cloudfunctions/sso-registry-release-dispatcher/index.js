/** Private timer Event Function dispatching approved Registry release intents. */

'use strict'

const { Buffer } = require('node:buffer')
const process = require('node:process')
const cloudbase = require('@cloudbase/node-sdk')

const { createWorkflowDispatcher } = require('./github-app')
const { runRegistryReleaseDispatch } = require('./service')
const { createDispatcherStore } = require('./store')

function decodeKey(value) {
  const raw = String(value || '').trim()
  if (raw.startsWith('-----'))
    return raw
  const decoded = Buffer.from(raw, 'base64').toString('utf8').trim()
  return decoded.startsWith('-----') ? decoded : raw
}

exports.main = async function main(_event, context = {}) {
  const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
  const dispatchWorkflow = createWorkflowDispatcher({
    appId: process.env.SSO_REGISTRY_GITHUB_APP_ID,
    installationId: process.env.SSO_REGISTRY_GITHUB_APP_INSTALLATION_ID,
    owner: 'YunLeFun',
    privateKey: decodeKey(process.env.SSO_REGISTRY_GITHUB_APP_PRIVATE_KEY),
    repository: 'www.yunle.fun',
  })
  const result = await runRegistryReleaseDispatch({
    dispatchWorkflow,
    leaseOwner: String(context.requestId || context.request_id || 'registry-dispatcher'),
    store: createDispatcherStore(app.database()),
  })
  console.warn('[sso-registry-release-dispatcher] completed', JSON.stringify(result))
  return { ok: true, ...result }
}

exports._private = { decodeKey }
