#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

export const REWARD_CLAIM_OPS_DEPLOYMENT_PLAN = {
  version: 1,
  defaultMode: 'dry-run',
  function: 'reward-claim-ops',
  trigger: {
    name: 'rewardClaimOpsEveryFiveMinutes',
    type: 'timer',
    config: '0 */5 * * * * *',
  },
  requiredEnvironmentVariables: [
    'ACCOUNT_API_INTERNAL_TOKEN',
    'REWARD_CLAIM_LINK_HASH_KEY',
    'REWARD_CLAIM_RATE_TICKET_SECRET',
    'REWARD_CLAIM_OPS_WEBHOOK_URL',
  ],
}

function optionValue(args, name) {
  return args.find(value => value.startsWith(`${name}=`))?.slice(name.length + 1) || ''
}

function secretsAreReady(env) {
  const values = REWARD_CLAIM_OPS_DEPLOYMENT_PLAN.requiredEnvironmentVariables
    .map(name => env[name])
  return values.every(value => typeof value === 'string' && value.length >= 32)
    && env.REWARD_CLAIM_LINK_HASH_KEY !== env.REWARD_CLAIM_RATE_TICKET_SECRET
}

export function main(args = process.argv.slice(2), env = process.env) {
  const apply = args.includes('--apply')
  const unknown = args.find(value => value !== '--apply' && !value.startsWith('--confirm-env='))
  if (unknown) {
    process.stderr.write(`Unknown option: ${unknown}\n`)
    return 2
  }
  if (!apply) {
    process.stdout.write(`${JSON.stringify({
      mode: 'dry-run',
      networkRequests: 0,
      writes: 0,
      plan: REWARD_CLAIM_OPS_DEPLOYMENT_PLAN,
    }, null, 2)}\n`)
    return 0
  }

  const envId = env.NUXT_CLOUDBASE_ENV_ID || ''
  if (!envId || optionValue(args, '--confirm-env') !== envId) {
    process.stderr.write('Refusing deploy: --confirm-env must exactly match NUXT_CLOUDBASE_ENV_ID.\n')
    return 2
  }
  if (!secretsAreReady(env)) {
    process.stderr.write('Refusing deploy: required secrets are missing, too short, or reused.\n')
    return 2
  }

  const result = spawnSync('tcb', [
    'fn',
    'deploy',
    REWARD_CLAIM_OPS_DEPLOYMENT_PLAN.function,
    '-e',
    envId,
  ], {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
  })
  if (result.error) {
    process.stderr.write(`Deploy failed: ${result.error.message}\n`)
    return 1
  }
  return result.status ?? 1
}

const isDirectRun = Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun)
  process.exitCode = main()
