#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_PATH = resolve(ROOT, 'cloudbaserc.json')

export const TEST_IDENTITY_FUNCTIONS = Object.freeze([
  'account-api',
  'sso-ticket',
  'test-identity-sweeper',
])

function deploymentPlan() {
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
  const configuredFunctions = new Map(config.functions?.map(item => [item.name, item]) || [])
  for (const name of TEST_IDENTITY_FUNCTIONS) {
    const item = configuredFunctions.get(name)
    if (!item)
      throw new Error(`cloudbaserc.json 未声明云函数：${name}`)
    if (item.runtime !== 'Nodejs18.15' || item.handler !== 'index.main')
      throw new Error(`云函数 ${name} 必须使用 Nodejs18.15 与 index.main`)
  }
  for (const name of ['account-api', 'sso-ticket']) {
    if (configuredFunctions.get(name).aclRule?.invoke !== 'auth != null')
      throw new Error(`云函数 ${name} 必须要求 CloudBase authentication`)
  }
  if (configuredFunctions.get('test-identity-sweeper').aclRule?.invoke !== false)
    throw new Error('test-identity-sweeper 必须禁止外部调用')
  if (typeof config.envId !== 'string' || !config.envId)
    throw new Error('cloudbaserc.json 缺少 envId')
  return { envId: config.envId, functions: [...TEST_IDENTITY_FUNCTIONS] }
}

function main() {
  const plan = deploymentPlan()
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const confirmation = args.find(argument => argument.startsWith('--confirm-env='))?.slice('--confirm-env='.length)
  const unknown = args.filter(argument => argument !== '--apply' && !argument.startsWith('--confirm-env='))
  if (unknown.length > 0)
    throw new Error(`Unknown argument: ${unknown.join(', ')}`)

  if (!apply) {
    console.log(JSON.stringify({
      mode: 'dry-run',
      ...plan,
      networkRequests: 0,
      writes: 0,
    }, null, 2))
    return
  }
  if (confirmation !== plan.envId)
    throw new Error(`--confirm-env must exactly match cloudbaserc envId (${plan.envId})`)

  const result = spawnSync(process.execPath, [
    'scripts/deploy-function.mjs',
    ...plan.functions,
  ], {
    cwd: ROOT,
    env: process.env,
    stdio: 'inherit',
  })
  if (result.status !== 0)
    process.exitCode = result.status || 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  }
  catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 2
  }
}
