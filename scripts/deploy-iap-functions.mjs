#!/usr/bin/env node
/**
 * Deploy App Store IAP CloudBase functions.
 *
 * Required local environment:
 * - APPSTORE_ISSUER_ID
 * - APPSTORE_KEY_ID
 * - APPSTORE_PRIVATE_KEY or APPSTORE_PRIVATE_KEY_FILE
 * - APPSTORE_APP_APPLE_ID
 * - APPSTORE_BUNDLE_ID (defaults to fun.yunle.apps)
 *
 * The script reads .env and .env.local, patches cloudbaserc.json with
 * {{env.APPSTORE_*}} placeholders, deploys functions, then restores the file.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CLOUDBASERC_PATH = resolve(ROOT, 'cloudbaserc.json')
const DEFAULT_FUNCTIONS = ['appstore-notify', 'iap-order']
const APPSTORE_KEYS = [
  'APPSTORE_ISSUER_ID',
  'APPSTORE_KEY_ID',
  'APPSTORE_PRIVATE_KEY',
  'APPSTORE_BUNDLE_ID',
  'APPSTORE_APP_APPLE_ID',
]

function printUsage() {
  console.log(`
Usage:
  node scripts/deploy-iap-functions.mjs [--dry-run] [function...]

Examples:
  APPSTORE_PRIVATE_KEY_FILE=~/Downloads/AuthKey_XXXX.p8 node scripts/deploy-iap-functions.mjs
  node scripts/deploy-iap-functions.mjs --dry-run
  node scripts/deploy-iap-functions.mjs iap-order
`.trim())
}

function parseArgs(argv) {
  const args = {
    dryRun: false,
    functions: [],
  }

  for (const arg of argv) {
    if (arg === '--dry-run') {
      args.dryRun = true
    }
    else if (arg === '--help' || arg === '-h') {
      printUsage()
      process.exit(0)
    }
    else if (arg.startsWith('-')) {
      throw new Error(`未知参数: ${arg}`)
    }
    else {
      args.functions.push(arg)
    }
  }

  return {
    ...args,
    functions: args.functions.length > 0 ? args.functions : DEFAULT_FUNCTIONS,
  }
}

function stripQuotes(value) {
  const trimmed = value.trim()
  const first = trimmed.at(0)
  const last = trimmed.at(-1)
  if ((first === '"' && last === '"') || (first === '\'' && last === '\''))
    return trimmed.slice(1, -1)
  return trimmed
}

function loadEnvFile(path) {
  if (!existsSync(path))
    return

  const lines = readFileSync(path, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#'))
      continue

    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex <= 0)
      continue

    const key = trimmed.slice(0, separatorIndex).trim()
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key))
      continue

    const rawValue = trimmed.slice(separatorIndex + 1).trim()
    if (process.env[key])
      continue

    process.env[key] = stripQuotes(rawValue)
  }
}

function loadLocalEnv() {
  loadEnvFile(resolve(ROOT, '.env'))
  loadEnvFile(resolve(ROOT, '.env.local'))
}

function expandHome(path) {
  if (path === '~')
    return process.env.HOME || path
  if (path.startsWith('~/'))
    return resolve(process.env.HOME || ROOT, path.slice(2))
  return path
}

function readEnv(name) {
  return process.env[name]?.trim() || ''
}

function normalizePrivateKey(value) {
  return value.replace(/\\n/g, '\n').trim()
}

function toJsonTemplateValue(value) {
  return value.replace(/\n/g, '\\n')
}

function prepareAppStoreEnv() {
  loadLocalEnv()

  if (!readEnv('APPSTORE_BUNDLE_ID'))
    process.env.APPSTORE_BUNDLE_ID = 'fun.yunle.apps'

  const privateKeyFile = readEnv('APPSTORE_PRIVATE_KEY_FILE')
  if (!readEnv('APPSTORE_PRIVATE_KEY') && privateKeyFile) {
    const path = resolve(ROOT, expandHome(privateKeyFile))
    process.env.APPSTORE_PRIVATE_KEY = readFileSync(path, 'utf8')
  }

  let privateKey = ''
  if (readEnv('APPSTORE_PRIVATE_KEY'))
    privateKey = normalizePrivateKey(readEnv('APPSTORE_PRIVATE_KEY'))

  const missing = APPSTORE_KEYS.filter(key => !readEnv(key))
  if (missing.length > 0) {
    throw new Error([
      `缺少环境变量: ${missing.join(', ')}`,
      '请在 .env.local 中配置，或运行时注入。',
      '私钥建议用 APPSTORE_PRIVATE_KEY_FILE 指向本地 .p8 文件。',
    ].join('\n'))
  }

  if (!privateKey.includes('BEGIN PRIVATE KEY'))
    throw new Error('APPSTORE_PRIVATE_KEY 不是有效 PEM 私钥内容')

  // tcb interpolates {{env.*}} before JSON.parse, so multiline PEM must stay JSON-safe.
  process.env.APPSTORE_PRIVATE_KEY = toJsonTemplateValue(privateKey)
}

function loadCloudbaserc() {
  const original = readFileSync(CLOUDBASERC_PATH, 'utf8')
  return {
    original,
    config: JSON.parse(original),
  }
}

function findFunction(config, functionName) {
  const fn = config.functions?.find(item => item.name === functionName)
  if (!fn)
    throw new Error(`cloudbaserc.json 中不存在云函数: ${functionName}`)
  return fn
}

function patchFunctionEnv(config, functionName) {
  const fn = findFunction(config, functionName)
  fn.envVariables = fn.envVariables || {}
  for (const key of APPSTORE_KEYS)
    fn.envVariables[key] = `{{env.${key}}}`
}

function run(command, args) {
  console.log(`  $ ${[command, ...args].join(' ')}`)
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
    stdio: 'pipe',
  })

  if (result.stdout)
    process.stdout.write(result.stdout)
  if (result.stderr)
    process.stderr.write(result.stderr)

  if (result.error)
    throw result.error
  const output = `${result.stdout || ''}\n${result.stderr || ''}`
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`)
  if (/unhandledRejection|SyntaxError:|部署失败|Error:/i.test(output))
    throw new Error(`${command} ${args.join(' ')} reported an error`)
}

function deployFunction(functionName, envId) {
  run('tcb', ['fn', 'deploy', functionName, '--envId', envId, '--force'])
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  prepareAppStoreEnv()

  const { original, config } = loadCloudbaserc()
  const envId = config.envId
  if (!envId)
    throw new Error('cloudbaserc.json 缺少 envId')

  for (const functionName of args.functions)
    patchFunctionEnv(config, functionName)

  console.log(`CloudBase envId: ${envId}`)
  console.log(`Functions: ${args.functions.join(', ')}`)
  console.log(`APPSTORE_*: ${APPSTORE_KEYS.join(', ')} resolved`)

  if (args.dryRun) {
    console.log('Dry run only. cloudbaserc.json was not changed.')
    return
  }

  try {
    writeFileSync(CLOUDBASERC_PATH, JSON.stringify(config, null, 2))

    for (const functionName of args.functions) {
      console.log(`\n--- ${functionName} ---`)
      deployFunction(functionName, envId)
    }

    console.log('\n部署完成')
  }
  finally {
    writeFileSync(CLOUDBASERC_PATH, original)
    console.log('cloudbaserc.json restored.')
  }
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
