#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const { SSO_REGISTRY_COLLECTION_MANIFESTS } = require('../cloudfunctions/sso-registry-admin/store.js')

const environments = {
  development: {
    config: resolve(ROOT, 'cloudbaserc.sso-development.json'),
    envId: 'yunlefun-dev-0ge03bdod37093d1',
    instanceId: 'tnt-5h8pxtjg4',
    region: 'ap-shanghai',
  },
}

function argument(name) {
  const prefix = `--${name}=`
  return process.argv.slice(2).find(value => value.startsWith(prefix))?.slice(prefix.length) || ''
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

function sameIndex(remote, expected) {
  return remote.Unique === expected.unique
    && JSON.stringify(remote.Keys) === JSON.stringify(expectedKeys(expected))
}

const environment = argument('environment')
const target = environments[environment]
if (!target)
  throw new Error('Only --environment=development is supported before the production rollout gate')
const apply = process.argv.includes('--apply')
if (apply && argument('confirm-env') !== target.envId)
  throw new Error(`--confirm-env=${target.envId} is required with --apply`)

const plan = []
for (const manifest of SSO_REGISTRY_COLLECTION_MANIFESTS) {
  const common = {
    EnvId: target.envId,
    Tag: target.instanceId,
    TableName: manifest.collection,
  }
  let table = callApi(target, 'DescribeTable', common, true)
  if (!table) {
    plan.push({ action: 'create', collection: manifest.collection })
    if (apply) {
      callApi(target, 'CreateTable', common)
      table = callApi(target, 'DescribeTable', common)
    }
  }
  const indexes = new Map((table?.Indexes || []).map(index => [index.Name, index]))
  const missingIndexes = []
  for (const index of manifest.indexes) {
    const existing = indexes.get(index.name)
    if (existing && !sameIndex(existing, index))
      throw new Error(`Index ${manifest.collection}.${index.name} exists with a different definition`)
    if (!existing)
      missingIndexes.push(index)
  }
  if (missingIndexes.length > 0) {
    plan.push({
      action: 'create_indexes',
      collection: manifest.collection,
      indexes: missingIndexes.map(index => index.name),
    })
    if (apply) {
      callApi(target, 'UpdateTable', {
        ...common,
        CreateIndexes: missingIndexes.map(index => ({
          IndexName: index.name,
          MgoKeySchema: {
            MgoIndexKeys: expectedKeys(index),
            MgoIsUnique: index.unique,
          },
        })),
      })
    }
  }
  const acl = table
    ? callApi(target, 'DescribeDatabaseACL', {
        EnvId: target.envId,
        CollectionName: manifest.collection,
      })
    : null
  if (acl?.AclTag !== 'ADMINONLY') {
    plan.push({ action: 'set_admin_only', collection: manifest.collection })
    if (apply) {
      callApi(target, 'ModifyDatabaseACL', {
        EnvId: target.envId,
        CollectionName: manifest.collection,
        AclTag: 'ADMINONLY',
      })
    }
  }
}

if (apply) {
  for (const manifest of SSO_REGISTRY_COLLECTION_MANIFESTS) {
    const table = callApi(target, 'DescribeTable', {
      EnvId: target.envId,
      Tag: target.instanceId,
      TableName: manifest.collection,
    })
    const indexes = new Map((table.Indexes || []).map(index => [index.Name, index]))
    if (manifest.indexes.some(index => !sameIndex(indexes.get(index.name) || {}, index)))
      throw new Error(`Index verification failed for ${manifest.collection}`)
    const acl = callApi(target, 'DescribeDatabaseACL', {
      EnvId: target.envId,
      CollectionName: manifest.collection,
    })
    if (acl.AclTag !== 'ADMINONLY')
      throw new Error(`ADMINONLY verification failed for ${manifest.collection}`)
  }
}

console.log(JSON.stringify({
  applied: apply,
  environment,
  envId: target.envId,
  collections: SSO_REGISTRY_COLLECTION_MANIFESTS.length,
  plan,
  verified: apply,
}, null, 2))
