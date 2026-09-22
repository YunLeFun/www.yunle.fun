#!/usr/bin/env node
/** Default: read-only. --apply requires an exact environment confirmation. */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { reconcileDesktopAuthIndexes } from './lib/desktop-auth-indexes.mjs'
import { parseCliJson } from './lib/sso-registry-transport.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TABLE = 'desktop_device_codes'
const TARGETS = {
  production: { config: 'cloudbaserc.json', envId: 'yunlefun-8g7ybcxc7345c490', tag: 'tnt-2la6mncfo' },
  development: { config: 'cloudbaserc.sso-development.json', envId: 'yunlefun-dev-0ge03bdod37093d1', tag: 'tnt-5h8pxtjg4' },
}

function decode(value) {
  if (Array.isArray(value))
    return value.map(decode)
  if (value && typeof value === 'object') {
    for (const key of ['$numberInt', '$numberLong', '$numberDouble']) {
      if (Object.hasOwn(value, key))
        return Number(value[key])
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item)]))
  }
  return value
}

export function createDesktopIndexAdapter(target, { run = spawnSync, env = process.env } = {}) {
  function call(args) {
    const result = run('pnpm', [
      '--package=@cloudbase/cli@3.6.4',
      'dlx',
      'tcb',
      '--config-file',
      resolve(ROOT, target.config),
      '--region',
      'ap-shanghai',
      ...args,
      '--json',
    ], { cwd: ROOT, env, encoding: 'utf8', timeout: 60_000, maxBuffer: 2 * 1024 * 1024 })
    if (result.status !== 0)
      throw new Error(`CloudBase ${args[0]} ${args[1]} failed (output suppressed)`)
    const response = parseCliJson(result.stdout)
    if (response.error || response.Error || (response.code && response.code !== 0))
      throw new Error('CloudBase request failed')
    return decode(response.data)
  }
  const api = (action, body) => call(['api', 'tcb', action, '--api-version', '2018-06-08', '--body', JSON.stringify(body)])
  const common = { EnvId: target.envId, Tag: target.tag, TableName: TABLE }
  async function readIndexes() {
    const response = call(['db', 'nosql', 'execute', '--command', JSON.stringify([
      { TableName: TABLE, CommandType: 'COMMAND', Command: JSON.stringify({ listIndexes: TABLE, cursor: {} }) },
    ])])
    if (!Array.isArray(response?.results?.[0]))
      throw new Error('Invalid index response')
    return response.results[0]
  }
  async function waitForIndex(name, present) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const indexes = await readIndexes()
      if (indexes.some(index => index.name === name) === present)
        return
      await new Promise(resolve => setTimeout(resolve, 1_000))
    }
    throw new Error(`Index operation did not complete for ${name}`)
  }
  return {
    async readState() {
      const indexes = await readIndexes()
      const queries = [
        { count: TABLE, query: {} },
        { count: TABLE, query: { userCodeHash: { $exists: false } } },
        { count: TABLE, query: { userCodeHash: { $exists: true, $not: { $type: 'string' } } } },
        { aggregate: TABLE, pipeline: [
          { $match: { userCodeHash: { $type: 'string' } } },
          { $group: { _id: '$userCodeHash', count: { $sum: 1 } } },
          { $match: { count: { $gt: 1 } } },
          { $count: 'count' },
        ], cursor: {} },
      ]
      const response = call(['db', 'nosql', 'execute', '--command', JSON.stringify(queries.map(query => ({
        TableName: TABLE,
        CommandType: 'COMMAND',
        Command: JSON.stringify(query),
      })))])
      const rows = response?.results
      if (!Array.isArray(rows) || rows.length !== 4 || !rows.every(Array.isArray))
        throw new Error('Invalid data audit response')
      const [total, missingHashes, invalidHashes] = rows.slice(0, 3).map(row => row[0]?.n)
      const duplicateHashes = rows[3].length === 0 ? 0 : rows[3][0]?.count
      if (![total, missingHashes, invalidHashes, duplicateHashes].every(value => Number.isSafeInteger(value) && value >= 0))
        throw new Error('Invalid data audit counters')
      const acl = api('DescribeDatabaseACL', { EnvId: target.envId, CollectionName: TABLE })
      return { indexes, audit: { total, missingHashes, invalidHashes, duplicateHashes }, acl: acl?.AclTag }
    },
    async createIndex(index) {
      api('UpdateTable', { ...common, CreateIndexes: [{ IndexName: index.name, MgoKeySchema: {
        MgoIndexKeys: Object.entries(index.key).map(([Name, order]) => ({ Name, Direction: String(order) })),
        MgoIsUnique: index.unique,
        MgoIsSparse: index.sparse,
      } }] })
      await waitForIndex(index.name, true)
    },
    async dropIndex(name) {
      api('UpdateTable', { ...common, DropIndexes: [{ IndexName: name }] })
      await waitForIndex(name, false)
    },
  }
}

export async function checkDesktopAuthIndexes(environment, options = {}) {
  const target = TARGETS[environment]
  if (!target || JSON.parse(readFileSync(resolve(ROOT, target.config), 'utf8')).envId !== target.envId)
    throw new Error('Invalid desktop authentication environment')
  if (options.apply && options.confirmEnv !== target.envId)
    throw new Error('--apply requires --confirm-env=<exact environment id>')
  return reconcileDesktopAuthIndexes(createDesktopIndexAdapter(target, options), options)
}

export function assertDesktopAuthIndexes(envId, { run = spawnSync, env = process.env } = {}) {
  const environment = Object.keys(TARGETS).find(key => TARGETS[key].envId === envId)
  if (!environment)
    throw new Error('Unknown desktop authentication deployment environment')
  const result = run(process.execPath, [fileURLToPath(import.meta.url), environment, '--check'], {
    cwd: ROOT,
    env,
    stdio: 'inherit',
  })
  if (result.status !== 0)
    throw new Error('Desktop authentication indexes are not ready; run the reviewed migration first')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  try {
    if (args.some(arg => !['production', 'development', '--apply', '--check'].includes(arg) && !arg.startsWith('--confirm-env=')))
      throw new Error('Usage: check-desktop-auth-indexes.mjs <environment> [--check | --apply --confirm-env=<id>]')
    const result = await checkDesktopAuthIndexes(args[0], {
      apply: args.includes('--apply'),
      confirmEnv: args.find(arg => arg.startsWith('--confirm-env='))?.split('=')[1],
    })
    console.log(JSON.stringify(result, null, 2))
    if (args.includes('--check') && !result.ready)
      process.exitCode = 1
  }
  catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
