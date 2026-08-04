#!/usr/bin/env node
/**
 * 通用云函数部署：读取 .env + .env.local 注入 process.env，再按 cloudbaserc.json 的 envId
 * 执行 `tcb fn deploy <name> --force`。cloudbaserc 里的 `{{env.X}}` 由 tcb 从 process.env 插值，
 * 因此密钥等敏感值只需放在（gitignore 的）.env.local，不进版本库、不进命令行。
 *
 * 用法：
 *   node scripts/deploy-function.mjs desktop-auth
 *   node scripts/deploy-function.mjs account-api wxpay-order
 *
 * 与 deploy-iap-functions.mjs 的区别：本脚本不针对特定业务、不改写 cloudbaserc，
 * 只做「装载本地 env + tcb 部署」，适合 env 占位已写好在 cloudbaserc 里的函数。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { buildCloudFunctionArtifacts } from './build-cloud-function.mjs'
import { assertFunctionEnvironmentReady } from './deploy-function-safety.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

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
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#'))
      continue
    const separatorIndex = trimmed.indexOf('=')
    if (separatorIndex <= 0)
      continue
    const key = trimmed.slice(0, separatorIndex).trim()
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key))
      continue
    if (process.env[key])
      continue
    process.env[key] = stripQuotes(trimmed.slice(separatorIndex + 1))
  }
}

const functions = process.argv.slice(2).filter(arg => !arg.startsWith('-'))
if (functions.length === 0) {
  console.error('用法: node scripts/deploy-function.mjs <function...>')
  process.exit(1)
}

loadEnvFile(resolve(ROOT, '.env'))
loadEnvFile(resolve(ROOT, '.env.local'))

const cloudbaseConfig = JSON.parse(readFileSync(resolve(ROOT, 'cloudbaserc.json'), 'utf8'))
const envId = cloudbaseConfig.envId
if (!envId)
  throw new Error('cloudbaserc.json 缺少 envId')

try {
  const requiredNames = assertFunctionEnvironmentReady(cloudbaseConfig, functions, process.env)
  if (requiredNames.length > 0)
    console.log(`环境变量检查通过：${requiredNames.join(', ')}`)
}
catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(2)
}

const artifacts = buildCloudFunctionArtifacts(functions)
for (const [index, name] of functions.entries()) {
  console.log(`\n--- deploy ${name} (env ${envId}) ---`)
  const artifact = artifacts[index]
  const result = spawnSync('tcb', ['fn', 'deploy', name, '--dir', artifact, '--envId', envId, '--force'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  })
  if (result.status !== 0) {
    console.error(`部署失败: ${name}`)
    process.exit(result.status || 1)
  }
}

console.log('\n部署完成')
