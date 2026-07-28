#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import acceptance from '../cloudfunctions/account-lifecycle-notifier/acceptance.js'

const {
  ACCEPTANCE_ACTION,
  createAcceptanceSignature,
} = acceptance
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEADLINE_TYPES = new Set([
  'deletion_requested',
  'deletion_reminder_7d',
  'deletion_reminder_1d',
])

function stripQuotes(value) {
  const trimmed = value.trim()
  const first = trimmed.at(0)
  const last = trimmed.at(-1)
  if ((first === '"' && last === '"') || (first === '\'' && last === '\''))
    return trimmed.slice(1, -1)
  return trimmed
}

export function loadEnvFile(path, env = process.env) {
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
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key) || env[key])
      continue
    env[key] = stripQuotes(trimmed.slice(separatorIndex + 1))
  }
}

function optionValue(args, index, name) {
  const value = args[index + 1]
  if (!value || value.startsWith('--'))
    throw new Error(`${name} 缺少参数`)
  return value
}

export function parseArgs(args) {
  const options = {}
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    if (argument === '--help' || argument === '-h')
      options.help = true
    else if (argument === '--type')
      options.type = optionValue(args, index++, '--type')
    else if (argument === '--run-id')
      options.runId = optionValue(args, index++, '--run-id')
    else if (argument === '--deadline-at')
      options.deadlineAt = optionValue(args, index++, '--deadline-at')
    else if (argument === '--env-id')
      options.envId = optionValue(args, index++, '--env-id')
    else
      throw new Error(`未知参数：${argument}`)
  }
  return options
}

export function buildAcceptanceEvent(options, {
  now = Date.now(),
  signingKey,
} = {}) {
  const type = options?.type
  const deadlineAt = options?.deadlineAt === undefined
    ? null
    : Date.parse(options.deadlineAt)
  if (DEADLINE_TYPES.has(type) && !Number.isSafeInteger(deadlineAt))
    throw new Error(`${type || '该模板'} 必须提供有效的 --deadline-at`)
  if (!DEADLINE_TYPES.has(type) && options?.deadlineAt !== undefined)
    throw new Error(`${type || '该模板'} 不接受 --deadline-at`)

  const event = {
    action: ACCEPTANCE_ACTION,
    deadlineAt,
    issuedAt: now,
    runId: options?.runId,
    type,
  }
  return {
    ...event,
    signature: createAcceptanceSignature(event, signingKey),
  }
}

function runCommand(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: process.env,
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('exit', (status, signal) => resolvePromise({ signal, status }))
  })
}

export async function invokeAcceptance({
  envId,
  event,
  run = runCommand,
}) {
  if (typeof envId !== 'string' || !envId.trim())
    throw new Error('缺少 CloudBase 环境 ID')
  const result = await run('tcb', [
    'fn',
    'invoke',
    'account-lifecycle-notifier',
    '--params',
    JSON.stringify(event),
    '-e',
    envId.trim(),
  ])
  if (result?.status !== 0)
    throw new Error(`CloudBase 验收调用失败（退出码 ${result?.status ?? 'unknown'}）`)
  return result
}

function configuredEnvId() {
  const config = JSON.parse(readFileSync(resolve(ROOT, 'cloudbaserc.json'), 'utf8'))
  return config.envId
}

function printHelp() {
  console.log(`用法：
  node scripts/send-ses-acceptance.mjs \\
    --type deletion_reminder_7d \\
    --run-id template-v2-acceptance-20260728 \\
    --deadline-at 2026-08-04T17:00:00+08:00

可选：
  --env-id <id>       覆盖 cloudbaserc.json 中的 envId
  --deadline-at <iso> 仅三个包含 deadline 的模板需要

收件人固定由云函数环境变量决定，命令行不接受邮箱参数。`)
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args)
  if (options.help) {
    printHelp()
    return
  }

  loadEnvFile(resolve(ROOT, '.env'))
  loadEnvFile(resolve(ROOT, '.env.local'))
  const event = buildAcceptanceEvent(options, {
    signingKey: process.env.SES_ACCEPTANCE_SIGNING_KEY,
  })
  console.log(`请求验收：${event.type} / ${event.runId}`)
  await invokeAcceptance({
    envId: options.envId || process.env.CLOUDBASE_ENV_ID || configuredEnvId(),
    event,
  })
}

const isDirectExecution = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectExecution) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
