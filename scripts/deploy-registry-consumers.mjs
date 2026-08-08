#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { buildCloudFunctionArtifacts } from './build-cloud-function.mjs'
import { assertFunctionEnvironmentReady } from './deploy-function-safety.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const environments = {
  development: {
    config: resolve(ROOT, 'cloudbaserc.sso-development.json'),
    envId: 'yunlefun-dev-0ge03bdod37093d1',
    functions: ['sso-ticket'],
  },
  production: {
    config: resolve(ROOT, 'cloudbaserc.json'),
    envId: 'yunlefun-8g7ybcxc7345c490',
    functions: ['desktop-auth', 'sso-ticket'],
  },
}

const target = process.argv[2]
const selected = environments[target]
if (!selected)
  throw new Error('usage: node scripts/deploy-registry-consumers.mjs <development|production>')
const config = JSON.parse(readFileSync(selected.config, 'utf8'))
if (config.envId !== selected.envId)
  throw new Error(`Registry consumer manifest does not match ${target}`)
assertFunctionEnvironmentReady(config, selected.functions, process.env)

function runTcb(args) {
  const result = spawnSync('pnpm', [
    '--package=@cloudbase/cli@3.6.4',
    'dlx',
    'tcb',
    '--config-file',
    selected.config,
    ...args,
  ], { cwd: ROOT, env: process.env, stdio: 'inherit' })
  if (result.status !== 0)
    process.exit(result.status || 1)
}

const artifacts = buildCloudFunctionArtifacts(selected.functions)
for (const [index, functionName] of selected.functions.entries()) {
  runTcb(['fn', 'deploy', functionName, '--dir', artifacts[index], '--force'])
  runTcb(['config', 'update', 'fn', functionName])
}

console.log(`Registry consumers deployed to ${selected.envId}`)
