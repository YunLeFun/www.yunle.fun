#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { buildCloudFunctionArtifact } from './build-cloud-function.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG = resolve(ROOT, 'cloudbaserc.sso-development.json')
const DEVELOPMENT_ENV_ID = 'yunlefun-dev-0ge03bdod37093d1'

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
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key) || process.env[key])
      continue
    process.env[key] = stripQuotes(trimmed.slice(separatorIndex + 1))
  }
}

function runTcb(args) {
  const result = spawnSync('pnpm', [
    '--package=@cloudbase/cli@3.6.4',
    'dlx',
    'tcb',
    '--config-file',
    CONFIG,
    ...args,
  ], {
    cwd: ROOT,
    env: process.env,
    stdio: 'inherit',
  })
  if (result.status !== 0)
    process.exit(result.status || 1)
}

loadEnvFile(resolve(ROOT, '.env.sso-development.local'))

const config = JSON.parse(readFileSync(CONFIG, 'utf8'))
if (config.envId !== DEVELOPMENT_ENV_ID)
  throw new Error('Development SSO deployment manifest points to an unexpected environment')

for (const name of [
  'ACCOUNT_API_INTERNAL_TOKEN',
  'SSO_IDENTITY_SIGNING_KEY',
  'SSO_IDENTITY_SIGNING_KID',
  'SSO_TICKET_PRIVATE_KEY_ID',
  'SSO_TICKET_PRIVATE_KEY',
]) {
  if (!process.env[name])
    throw new Error(`${name} is required in .env.sso-development.local or the process environment`)
}

runTcb(['fn', 'deploy', 'account-api', '--dir', resolve(ROOT, 'cloudfunctions/account-api'), '--force'])
const ticketArtifact = buildCloudFunctionArtifact('sso-ticket')
runTcb(['fn', 'deploy', 'sso-ticket', '--dir', ticketArtifact, '--path', '/sso-ticket', '--force'])
runTcb(['fn', 'deploy', 'sso-security-sweeper', '--dir', resolve(ROOT, 'cloudfunctions/sso-security-sweeper'), '--force'])
const hasRegistryKey = Boolean(process.env.SSO_REGISTRY_SIGNING_KEY)
const hasRegistryKid = Boolean(process.env.SSO_REGISTRY_SIGNING_KID)
if (hasRegistryKey !== hasRegistryKid)
  throw new Error('SSO_REGISTRY_SIGNING_KEY and SSO_REGISTRY_SIGNING_KID must be configured together')
const configuredFunctions = ['account-api', 'sso-ticket', 'sso-security-sweeper']
if (hasRegistryKey && hasRegistryKid) {
  const registryArtifact = buildCloudFunctionArtifact('sso-registry-admin')
  runTcb(['fn', 'deploy', 'sso-registry-admin', '--dir', registryArtifact, '--force'])
  configuredFunctions.push('sso-registry-admin')
}
else {
  console.warn('Registry signing key is absent; skipping sso-registry-admin deployment')
}
for (const name of configuredFunctions)
  runTcb(['config', 'update', 'fn', name])

console.log(`Development SSO functions deployed to ${DEVELOPMENT_ENV_ID}`)
