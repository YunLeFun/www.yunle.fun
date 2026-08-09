#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { buildCloudFunctionArtifacts } from './build-cloud-function.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const REGISTRY_CONSUMER_ENVIRONMENTS = {
  development: {
    config: resolve(ROOT, 'cloudbaserc.sso-development.json'),
    envId: 'yunlefun-dev-0ge03bdod37093d1',
    functions: ['sso-registry-admin', 'sso-ticket'],
  },
  production: {
    config: resolve(ROOT, 'cloudbaserc.json'),
    envId: 'yunlefun-8g7ybcxc7345c490',
    functions: ['desktop-auth', 'sso-registry-admin', 'sso-ticket'],
  },
}

export function deployRegistryConsumers(target, {
  build = buildCloudFunctionArtifacts,
  env = process.env,
  run = spawnSync,
} = {}) {
  const selected = REGISTRY_CONSUMER_ENVIRONMENTS[target]
  if (!selected)
    throw new Error('usage: node scripts/deploy-registry-consumers.mjs <development|production>')

  const config = JSON.parse(readFileSync(selected.config, 'utf8'))
  if (config.envId !== selected.envId)
    throw new Error(`Registry consumer manifest does not match ${target}`)
  const configuredFunctions = new Set(config.functions?.map(item => item.name))
  for (const functionName of selected.functions) {
    if (!configuredFunctions.has(functionName))
      throw new Error(`Registry consumer manifest does not declare ${functionName}`)
  }

  const artifacts = build(selected.functions)
  for (const [index, functionName] of selected.functions.entries()) {
    const args = [
      '--package=@cloudbase/cli@3.6.4',
      'dlx',
      'tcb',
      '--config-file',
      selected.config,
      'fn',
      'code',
      'update',
      functionName,
      '--dir',
      artifacts[index],
      '--json',
    ]
    const result = run('pnpm', args, {
      cwd: ROOT,
      env,
      stdio: 'inherit',
    })
    if (result.status !== 0)
      throw new Error(`CloudBase code update failed for ${functionName}`)
  }

  console.log(`Registry consumers deployed to ${selected.envId}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    deployRegistryConsumers(process.argv[2])
  }
  catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
