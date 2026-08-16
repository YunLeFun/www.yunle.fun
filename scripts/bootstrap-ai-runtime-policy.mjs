#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const POLICY_PATH = resolve(ROOT, 'services/advjs-ai-runtime/runtime-policy.bootstrap.json')
const requireFromRuntime = createRequire(resolve(ROOT, 'services/advjs-ai-runtime/package.json'))
const cloudbase = requireFromRuntime('@cloudbase/node-sdk')
const CAPABILITIES = [
  'generate-outline',
  'generate-chapter-draft',
  'suggest-plot',
  'simulate-roleplay',
  'check-consistency',
]

function argument(name) {
  const prefix = `--${name}=`
  return process.argv.slice(2).find(value => value.startsWith(prefix))?.slice(prefix.length) || ''
}

function manifest() {
  const policy = JSON.parse(readFileSync(POLICY_PATH, 'utf8'))
  const safeIntegerFields = [
    policy?.initialGrantMicroPoints,
    policy?.perUserDailyTaskLimit,
    policy?.perUserDailyChargeLimitMicroPoints,
    policy?.globalDailyProviderCapMicroCny,
    policy?.updatedAt,
    policy?.pricing?.billingUnit,
    policy?.pricing?.inputMicroCnyPerUnit,
    policy?.pricing?.outputMicroCnyPerUnit,
    policy?.pricing?.cachedInputMicroCnyPerUnit,
    policy?.pricing?.reasoningMicroCnyPerUnit,
    policy?.pricing?.userRateBps,
    policy?.pricing?.fixedCapabilityFeeMicroPoints,
    policy?.pricing?.minimumChargeMicroPoints,
  ]
  if (policy?.id !== 'policy:active'
    || policy.enabled !== false
    || policy.modelEnabled !== false
    || policy.betaOnly !== true
    || policy.providerGroup !== 'cloudbase'
    || policy.model !== 'deepseek-v4-flash'
    || policy.pricing?.version !== 'cloudbase_deepseek-v4-flash_2026-08-15_v1'
    || safeIntegerFields.some(value => !Number.isSafeInteger(value) || value < 0)
    || Object.keys(policy.capabilities ?? {}).length !== CAPABILITIES.length
    || !CAPABILITIES.every(id => policy.capabilities?.[id] === false)) {
    throw new Error('AI Runtime bootstrap policy must be complete and fail closed')
  }
  return policy
}

function target(mode) {
  const envId = argument('env-id')
  const environment = argument('environment')
  if (!/^[a-z0-9][a-z0-9-]{10,63}$/i.test(envId))
    throw new Error(`--env-id=<canonical EnvId> is required with --${mode}`)
  if (!['development', 'production'].includes(environment))
    throw new Error('--environment must be development or production')
  return { envId, environment }
}

function assertApplyGate() {
  const selected = target('apply')
  if (argument('confirm-env') !== selected.envId)
    throw new Error(`--confirm-env=${selected.envId} is required with --apply`)
  if (argument('confirm-write') !== 'BOOTSTRAP_DISABLED_ADVJS_AI_RUNTIME_POLICY')
    throw new Error('--confirm-write=BOOTSTRAP_DISABLED_ADVJS_AI_RUNTIME_POLICY is required with --apply')
  if (selected.environment === 'production'
    && argument('confirm-production') !== 'BOOTSTRAP_DISABLED_ADVJS_AI_RUNTIME_POLICY_PRODUCTION') {
    throw new Error('--confirm-production=BOOTSTRAP_DISABLED_ADVJS_AI_RUNTIME_POLICY_PRODUCTION is required for production')
  }
  return selected
}

function documentData(result) {
  if (Array.isArray(result?.data))
    return result.data[0]
  return result?.data
}

async function policyReference(envId) {
  const app = cloudbase.init({ env: envId })
  return {
    app,
    reference: app.database().collection('ai_runtime_control').doc('policy:active'),
  }
}

const inspect = process.argv.includes('--inspect')
const apply = process.argv.includes('--apply')
if (inspect && apply)
  throw new Error('--inspect and --apply are mutually exclusive')

const policy = manifest()
if (!inspect && !apply) {
  console.log(JSON.stringify({ mode: 'manifest', network: false, applied: false, policy }, null, 2))
}
else if (inspect) {
  const selected = target('inspect')
  const { reference } = await policyReference(selected.envId)
  const remote = documentData(await reference.get()) ?? null
  console.log(JSON.stringify({
    mode: 'inspect',
    network: true,
    applied: false,
    environment: selected.environment,
    envId: selected.envId,
    remote,
    policy,
    safeToBootstrap: remote === null,
  }, null, 2))
}
else {
  const selected = assertApplyGate()
  const { app } = await policyReference(selected.envId)
  const written = await app.database().runTransaction(async (transaction) => {
    const reference = transaction.collection('ai_runtime_control').doc('policy:active')
    if (documentData(await reference.get()))
      throw new Error('Active policy already exists; bootstrap never overwrites it')
    const next = { ...policy, _id: 'policy:active', updatedAt: Date.now() }
    await reference.set({ data: next })
    return next
  })
  const { reference } = await policyReference(selected.envId)
  const verified = documentData(await reference.get())
  if (!verified || verified.enabled !== false || verified.modelEnabled !== false)
    throw new Error('Disabled AI Runtime policy read-back verification failed')
  console.log(JSON.stringify({
    mode: 'apply',
    network: true,
    applied: true,
    environment: selected.environment,
    envId: selected.envId,
    policy: written,
    verified: true,
  }, null, 2))
}
