#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { buildAiRuntimeResourcePlan } from './lib/ai-runtime-resource-plan.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { AI_RUNTIME_COLLECTION_MANIFESTS } = require('../cloudfunctions/account-api/ai-point-resources.js')

function argument(name) {
  const prefix = `--${name}=`
  return process.argv.slice(2).find(value => value.startsWith(prefix))?.slice(prefix.length) || ''
}

function configPath(value, mode) {
  if (!value)
    throw new Error(`--config-file is required with --${mode}`)
  const path = isAbsolute(value) ? resolve(value) : resolve(ROOT, value)
  if (path !== ROOT && !path.startsWith(`${ROOT}/`))
    throw new Error('--config-file must stay inside the repository')
  return path
}

function targetOptions(mode) {
  const environment = argument('environment')
  const envId = argument('env-id')
  const instanceId = argument('instance-id')
  const region = argument('region')
  if (!envId)
    throw new Error(`--env-id is required with --${mode}`)
  if (!/^[a-z0-9][a-z0-9-]{10,63}$/i.test(envId))
    throw new Error('--env-id must be a canonical full CloudBase EnvId')
  if (!instanceId)
    throw new Error(`--instance-id is required with --${mode}`)
  if (!region)
    throw new Error(`--region is required with --${mode}`)
  if (!['development', 'production'].includes(environment))
    throw new Error('--environment must be development or production')
  return {
    environment,
    envId,
    instanceId,
    region,
    config: configPath(argument('config-file'), mode),
  }
}

function assertApplyGate() {
  const target = targetOptions('apply')
  const confirmEnv = argument('confirm-env')
  if (confirmEnv !== target.envId)
    throw new Error(`--confirm-env=${target.envId} is required with --apply`)
  if (argument('confirm-write') !== 'CREATE_YUNLEFUN_AI_RUNTIME_RESOURCES')
    throw new Error('--confirm-write=CREATE_YUNLEFUN_AI_RUNTIME_RESOURCES is required with --apply')
  if (target.environment === 'production'
    && argument('confirm-production') !== 'PROVISION_YUNLEFUN_AI_RUNTIME_PRODUCTION') {
    throw new Error('--confirm-production=PROVISION_YUNLEFUN_AI_RUNTIME_PRODUCTION is required for production')
  }
  return target
}

function parseJson(output) {
  const first = output.indexOf('{')
  const last = output.lastIndexOf('}')
  if (first < 0 || last <= first)
    throw new Error('CloudBase CLI returned no JSON response')
  return JSON.parse(output.slice(first, last + 1)).data
}

function callApi(target, action, body, allowMissing = false) {
  const result = spawnSync('pnpm', [
    '--package=@cloudbase/cli@3.6.4',
    'dlx',
    'tcb',
    '--config-file',
    target.config,
    '--region',
    target.region,
    'api',
    'tcb',
    action,
    '--api-version',
    '2018-06-08',
    '--body',
    JSON.stringify(body),
    '--json',
  ], { cwd: ROOT, encoding: 'utf8' })
  const output = `${result.stdout || ''}\n${result.stderr || ''}`
  if (result.status !== 0) {
    if (allowMissing && /ResourceNotFound(?:\.Table)?|not found/i.test(output))
      return null
    throw new Error(`${action} failed: ${output.trim()}`)
  }
  return parseJson(output)
}

function expectedKeys(index) {
  return index.fields.map(field => ({
    Name: field.field,
    Direction: field.order === 'desc' ? '-1' : '1',
  }))
}

function remoteIndex(index) {
  return {
    name: index.Name,
    unique: Boolean(index.Unique),
    fields: (index.Keys || []).map(field => ({
      field: field.Name,
      order: field.Direction === '-1' ? 'desc' : 'asc',
    })),
  }
}

function inspectRemote(target) {
  return AI_RUNTIME_COLLECTION_MANIFESTS.map((manifest) => {
    const common = {
      EnvId: target.envId,
      Tag: target.instanceId,
      TableName: manifest.collection,
    }
    const table = callApi(target, 'DescribeTable', common, true)
    if (!table)
      return null
    const acl = callApi(target, 'DescribeDatabaseACL', {
      EnvId: target.envId,
      CollectionName: manifest.collection,
    })
    return {
      collection: manifest.collection,
      access: acl?.AclTag || '',
      indexes: (table.Indexes || []).map(remoteIndex),
    }
  }).filter(Boolean)
}

function applyPlan(target, plan) {
  for (const action of plan.actions) {
    const common = {
      EnvId: target.envId,
      Tag: target.instanceId,
      TableName: action.collection,
    }
    if (action.kind === 'create_collection') {
      callApi(target, 'CreateTable', common)
    }
    else if (action.kind === 'create_index') {
      callApi(target, 'UpdateTable', {
        ...common,
        CreateIndexes: [{
          IndexName: action.index.name,
          MgoKeySchema: {
            MgoIndexKeys: expectedKeys(action.index),
            MgoIsUnique: action.index.unique,
          },
        }],
      })
    }
    else if (action.kind === 'set_access') {
      callApi(target, 'ModifyDatabaseACL', {
        EnvId: target.envId,
        CollectionName: action.collection,
        AclTag: action.access,
      })
    }
  }
}

const apply = process.argv.includes('--apply')
const inspect = process.argv.includes('--inspect')
const snapshot = argument('snapshot')
if (apply && inspect)
  throw new Error('--apply and --inspect are mutually exclusive')
if (inspect) {
  const target = targetOptions('inspect')
  const before = inspectRemote(target)
  const plan = buildAiRuntimeResourcePlan({ remoteCollections: before })
  console.log(JSON.stringify({
    mode: 'inspect',
    network: true,
    applied: false,
    environment: target.environment,
    envId: target.envId,
    collections: AI_RUNTIME_COLLECTION_MANIFESTS.length,
    remoteCollections: before,
    manifests: AI_RUNTIME_COLLECTION_MANIFESTS,
    plan,
  }, null, 2))
}
else if (!apply) {
  const plan = snapshot
    ? buildAiRuntimeResourcePlan({
        remoteCollections: JSON.parse(readFileSync(resolve(ROOT, snapshot), 'utf8')).collections,
      })
    : null
  console.log(JSON.stringify({
    mode: snapshot ? 'dry-run' : 'manifest',
    network: false,
    applied: false,
    collections: AI_RUNTIME_COLLECTION_MANIFESTS.length,
    manifests: AI_RUNTIME_COLLECTION_MANIFESTS,
    ...(plan ? { plan } : {}),
  }, null, 2))
}
else {
  const target = assertApplyGate()
  const before = inspectRemote(target)
  const plan = buildAiRuntimeResourcePlan({ remoteCollections: before })
  if (!plan.safe)
    throw new Error(`Unsafe CloudBase resource drift: ${JSON.stringify(plan.unsafe)}`)
  applyPlan(target, plan)
  const verification = buildAiRuntimeResourcePlan({ remoteCollections: inspectRemote(target) })
  if (!verification.safe || verification.actions.length > 0)
    throw new Error(`CloudBase resource verification failed: ${JSON.stringify(verification)}`)
  console.log(JSON.stringify({
    mode: 'apply',
    network: true,
    applied: true,
    environment: target.environment,
    envId: target.envId,
    collections: AI_RUNTIME_COLLECTION_MANIFESTS.length,
    plan,
    verified: true,
  }, null, 2))
}
