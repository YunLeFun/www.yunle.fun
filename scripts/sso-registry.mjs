#!/usr/bin/env node

import { Buffer } from 'node:buffer'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { createVerifiedRegistryArtifact } from './lib/sso-registry-artifact.mjs'
import { createReleaseArtifacts } from './lib/sso-registry-release.mjs'
import {
  createFunctionInvokeArgs,
  parseCliJson,
  unwrapFunctionResult,
} from './lib/sso-registry-transport.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const ENV_CONFIGS = {
  production: resolve(ROOT, 'cloudbaserc.json'),
  development: resolve(ROOT, 'cloudbaserc.sso-development.json'),
}
const GENERATED_PATHS = {
  production: resolve(ROOT, 'packages/authorization-core/src/generated/production-registry.json'),
  development: resolve(ROOT, 'packages/authorization-core/src/generated/development-registry.json'),
}

function usage() {
  return `Usage:
  node scripts/sso-registry.mjs validate <file> --environment <production|development>
  node scripts/sso-registry.mjs draft <file> --environment <production|development> --operator <id> --reason <text>
  node scripts/sso-registry.mjs seed --environment <env> --operator <id> --reason <text> [--apply]
  node scripts/sso-registry.mjs diff --environment <env> --draft <id> --operator <id> --reason <text>
  node scripts/sso-registry.mjs request-approval --environment production --draft <id> --base-commit <sha> --operator <id> --reason <text>
  SSO_REGISTRY_APPROVAL_CODE=<code> node scripts/sso-registry.mjs approve --environment production --approval <id> --operator <id> --reason <text>
  node scripts/sso-registry.mjs queue --environment development --draft <id> --base-commit <sha> --operator <id> --reason <text>
  node scripts/sso-registry.mjs rollback-approval --environment <env> --snapshot <id> --base-commit <sha> --operator <id> --reason <text>
  node scripts/sso-registry.mjs release-export --environment <env> --release-intent <id> --operator <id> --reason <text>
  node scripts/sso-registry.mjs verify-release <file> --environment <env>
  node scripts/sso-registry.mjs record-ci --environment <env> --release-intent <id> --status <status> --operator <id> --reason <text> [--run-id <id>] [--pr <number>] [--merge-commit <sha>]
  node scripts/sso-registry.mjs record-deployment --environment <env> --release-intent <id> --status <status> --merge-commit <sha> --consumers <json> --operator <id> --reason <text>
  node scripts/sso-registry.mjs export --environment <env> --operator <id> --reason <text> [--output <file>]
  node scripts/sso-registry.mjs compare --environment <env> --operator <id> --reason <text>

seed is dry-run unless --apply is present. export prints to stdout unless --output is present.`
}

function parseArgs(argv) {
  const [command, positional, ...rest] = argv
  const options = { command, positional, apply: false }
  const tokens = ['validate', 'draft', 'verify-release'].includes(command) ? rest : [positional, ...rest].filter(Boolean)
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]
    if (token === '--apply') {
      options.apply = true
      continue
    }
    if (!token.startsWith('--'))
      throw new Error(`Unexpected argument: ${token}`)
    const value = tokens[++index]
    if (!value || value.startsWith('--'))
      throw new Error(`Missing value for ${token}`)
    options[token.slice(2)] = value
  }
  return options
}

function environment(value) {
  if (value !== 'production' && value !== 'development')
    throw new Error('--environment must be production or development')
  return value
}

function managementMetadata(options, fallbackReason) {
  const operator = typeof options.operator === 'string' ? options.operator.trim() : ''
  const changeReason = typeof options.reason === 'string' ? options.reason.trim() : fallbackReason
  if (!operator)
    throw new Error('--operator is required for management-plane reads and writes')
  if (!changeReason)
    throw new Error('--reason is required')
  return { operator, changeReason }
}

function requiredOption(options, name) {
  const value = typeof options[name] === 'string' ? options[name].trim() : ''
  if (!value)
    throw new Error(`--${name} is required`)
  return value
}

function ciToken() {
  const value = String(process.env.SSO_REGISTRY_CI_TOKEN || '')
  if (Buffer.byteLength(value, 'utf8') < 32)
    throw new Error('SSO_REGISTRY_CI_TOKEN must be configured')
  return value
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: options.capture ? 'utf8' : undefined,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: process.env,
  })
  if (result.status !== 0) {
    const details = options.capture ? String(result.stderr || result.stdout || '').trim() : ''
    throw new Error(`${command} ${args.join(' ')} failed${details ? `: ${details}` : ''}`)
  }
  return options.capture ? String(result.stdout || '') : ''
}

function loadCore() {
  run('pnpm', ['build:authorization-core'])
  const path = resolve(ROOT, 'packages/authorization-core/dist/index.js')
  delete require.cache[path]
  return require(path)
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  }
  catch (error) {
    throw new Error(`Unable to read JSON ${path}: ${error.message}`)
  }
}

function stablePrettyJson(value, core) {
  return `${JSON.stringify(JSON.parse(core.canonicalJson(value)), null, 2)}\n`
}

function invokeAdmin(targetEnvironment, action, payload) {
  const output = run('pnpm', createFunctionInvokeArgs({
    configFile: ENV_CONFIGS[targetEnvironment],
    functionName: 'sso-registry-admin',
    payload: { action, ...payload },
  }), { capture: true })
  return unwrapFunctionResult(parseCliJson(output))
}

function validate(options, core) {
  if (!options.positional)
    throw new Error('validate requires a JSON file')
  const targetEnvironment = environment(options.environment)
  const input = readJson(resolve(process.cwd(), options.positional))
  const parsed = input?.formatVersion === 1 && input?.registry
    ? core.parseGeneratedRegistryArtifact(input, targetEnvironment).registry
    : core.parseClientRegistrySnapshot(input, { environment: targetEnvironment })
  const hashes = core.hashRegistry(parsed)
  console.log(JSON.stringify({
    ok: true,
    environment: targetEnvironment,
    policyVersion: parsed.policyVersion,
    clientCount: parsed.clients.length,
    contentHash: hashes.contentHash,
    securityHash: hashes.securityHash,
  }, null, 2))
}

function saveDraft(options, core) {
  if (!options.positional)
    throw new Error('draft requires a JSON file')
  const targetEnvironment = environment(options.environment)
  const input = readJson(resolve(process.cwd(), options.positional))
  const registry = input?.formatVersion === 1 && input?.registry
    ? core.parseGeneratedRegistryArtifact(input, targetEnvironment).registry
    : core.parseClientRegistrySnapshot(input, { environment: targetEnvironment })
  return invokeAdmin(targetEnvironment, 'saveDraft', {
    ...managementMetadata(options, 'Registry draft save'),
    registry,
  })
}

function seed(options, core) {
  const targetEnvironment = environment(options.environment)
  const metadata = managementMetadata(options, 'initial Registry seed')
  const artifact = core.parseGeneratedRegistryArtifact(readJson(GENERATED_PATHS[targetEnvironment]), targetEnvironment)
  const payload = {
    ...metadata,
    registry: artifact.registry,
  }
  if (!options.apply) {
    const { canonicalJson: _canonicalJson, ...hashes } = core.hashRegistry(artifact.registry)
    console.log(JSON.stringify({
      dryRun: true,
      action: 'saveDraft',
      environment: targetEnvironment,
      operator: metadata.operator,
      changeReason: metadata.changeReason,
      policyVersion: artifact.registry.policyVersion,
      clientCount: artifact.registry.clients.length,
      hashes,
    }, null, 2))
    return
  }
  console.log(JSON.stringify(invokeAdmin(targetEnvironment, 'saveDraft', payload), null, 2))
}

function invokeManagementCommand(options, action, payload = {}) {
  const targetEnvironment = environment(options.environment)
  const metadata = managementMetadata(options, `Registry ${action}`)
  return invokeAdmin(targetEnvironment, action, { ...metadata, ...payload })
}

function draftDiff(options) {
  return invokeManagementCommand(options, 'getDraftDiff', {
    draftId: requiredOption(options, 'draft'),
  })
}

function requestApproval(options) {
  return invokeManagementCommand(options, 'requestPublishApproval', {
    approverUid: options.approver,
    baseCommitSha: requiredOption(options, 'base-commit'),
    draftId: requiredOption(options, 'draft'),
  })
}

function approveRelease(options) {
  return invokeManagementCommand(options, 'approveAndQueueRelease', {
    approvalId: requiredOption(options, 'approval'),
    code: requiredOption({ code: process.env.SSO_REGISTRY_APPROVAL_CODE }, 'code'),
  })
}

function queueDevelopmentRelease(options) {
  return invokeManagementCommand(options, 'approveAndQueueRelease', {
    baseCommitSha: requiredOption(options, 'base-commit'),
    draftId: requiredOption(options, 'draft'),
  })
}

function requestRollback(options) {
  return invokeManagementCommand(options, 'requestRollbackApproval', {
    approverUid: options.approver,
    baseCommitSha: requiredOption(options, 'base-commit'),
    targetSnapshotId: requiredOption(options, 'snapshot'),
  })
}

function releaseExport(options, core) {
  const targetEnvironment = environment(options.environment)
  const releaseIntentId = requiredOption(options, 'release-intent')
  const metadata = managementMetadata(options, 'Registry CI release export')
  const local = core.parseGeneratedRegistryArtifact(readJson(GENERATED_PATHS[targetEnvironment]), targetEnvironment)
  const response = invokeAdmin(targetEnvironment, 'getReleaseIntent', {
    ...metadata,
    ciToken: ciToken(),
    releaseIntentId,
  })
  const artifacts = createReleaseArtifacts({
    core,
    environment: targetEnvironment,
    localArtifact: local,
    releaseIntentId,
    response,
    trustAnchors: core.registryTrustAnchors,
  })
  const releasePath = resolve(ROOT, 'packages/authorization-core/src/generated', `${targetEnvironment}-release.json`)
  writeFileSync(GENERATED_PATHS[targetEnvironment], stablePrettyJson(artifacts.registryArtifact, core), { flag: 'w' })
  writeFileSync(releasePath, stablePrettyJson(artifacts.releaseManifest, core), { flag: 'w' })
  return {
    ok: true,
    environment: targetEnvironment,
    releaseIntentId,
    registryPath: GENERATED_PATHS[targetEnvironment],
    releasePath,
    generation: artifacts.registryArtifact.minimumGeneration,
    contentHash: artifacts.releaseManifest.intent.contentHash,
  }
}

function verifyRelease(options, core) {
  if (!options.positional)
    throw new Error('verify-release requires a release JSON file')
  const targetEnvironment = environment(options.environment)
  const releaseManifest = readJson(resolve(process.cwd(), options.positional))
  const local = core.parseGeneratedRegistryArtifact(readJson(GENERATED_PATHS[targetEnvironment]), targetEnvironment)
  const artifacts = createReleaseArtifacts({
    core,
    environment: targetEnvironment,
    localArtifact: local,
    releaseIntentId: requiredOption(releaseManifest, 'releaseIntentId'),
    response: releaseManifest,
    trustAnchors: core.registryTrustAnchors,
  })
  const expectedRegistry = stablePrettyJson(artifacts.registryArtifact, core)
  const actualRegistry = readFileSync(GENERATED_PATHS[targetEnvironment], 'utf8')
  if (expectedRegistry !== actualRegistry)
    throw new Error('release_registry_artifact_mismatch')
  return {
    ok: true,
    environment: targetEnvironment,
    releaseIntentId: releaseManifest.releaseIntentId,
    generation: artifacts.registryArtifact.minimumGeneration,
    baseCommitSha: artifacts.releaseManifest.intent.baseCommitSha,
    contentHash: artifacts.releaseManifest.intent.contentHash,
  }
}

function recordCiProgress(options) {
  return invokeManagementCommand(options, 'recordCiProgress', {
    ciToken: ciToken(),
    releaseIntentId: requiredOption(options, 'release-intent'),
    status: requiredOption(options, 'status'),
    ...(options['run-id'] ? { githubRunId: options['run-id'] } : {}),
    ...(options.pr ? { pullRequestNumber: Number(options.pr) } : {}),
    ...(options['merge-commit'] ? { mergeCommitSha: options['merge-commit'] } : {}),
    ...(options.failure ? { failureCode: options.failure } : {}),
  })
}

function recordDeployment(options) {
  let deployedConsumers
  try {
    deployedConsumers = JSON.parse(requiredOption(options, 'consumers'))
  }
  catch {
    throw new Error('--consumers must be valid JSON')
  }
  return invokeManagementCommand(options, 'recordDeploymentResult', {
    ciToken: ciToken(),
    deployedConsumers,
    releaseIntentId: requiredOption(options, 'release-intent'),
    status: requiredOption(options, 'status'),
    mergeCommitSha: requiredOption(options, 'merge-commit'),
    ...(options.failure ? { failureCode: options.failure } : {}),
  })
}

function fetchEnvelope(options) {
  const targetEnvironment = environment(options.environment)
  const metadata = managementMetadata(options, 'Registry snapshot read')
  return invokeAdmin(targetEnvironment, 'getActiveEnvelope', metadata)
}

function exportedArtifact(options, core) {
  const targetEnvironment = environment(options.environment)
  const local = core.parseGeneratedRegistryArtifact(
    readJson(GENERATED_PATHS[targetEnvironment]),
    targetEnvironment,
  )
  return createVerifiedRegistryArtifact({
    environment: targetEnvironment,
    envelope: fetchEnvelope(options),
    minimumGeneration: local.minimumGeneration,
    trustAnchors: core.registryTrustAnchors,
    verifyRegistryActiveEnvelope: core.verifyRegistryActiveEnvelope,
  })
}

function exportRegistry(options, core) {
  const artifact = exportedArtifact(options, core)
  const serialized = stablePrettyJson(artifact, core)
  if (!options.output) {
    process.stdout.write(serialized)
    return
  }
  const output = resolve(process.cwd(), options.output)
  writeFileSync(output, serialized, { flag: 'w' })
  console.log(JSON.stringify({ ok: true, output, contentHash: artifact.activeEnvelope.snapshot.contentHash }, null, 2))
}

function compare(options, core) {
  const targetEnvironment = environment(options.environment)
  const remote = exportedArtifact(options, core)
  const localPath = GENERATED_PATHS[targetEnvironment]
  if (!existsSync(localPath))
    throw new Error(`Generated Registry is missing: ${localPath}`)
  const local = core.parseGeneratedRegistryArtifact(readJson(localPath), targetEnvironment)
  const remoteBytes = stablePrettyJson(remote, core)
  const localBytes = stablePrettyJson(local, core)
  if (remoteBytes !== localBytes) {
    console.error(JSON.stringify({
      ok: false,
      environment: targetEnvironment,
      localGeneration: local.minimumGeneration,
      remoteGeneration: remote.minimumGeneration,
      localContentHash: core.hashRegistry(local.registry).contentHash,
      remoteContentHash: remote.activeEnvelope.snapshot.contentHash,
    }, null, 2))
    process.exitCode = 2
    return
  }
  console.log(JSON.stringify({
    ok: true,
    environment: targetEnvironment,
    generation: remote.minimumGeneration,
    snapshotId: remote.activeEnvelope.snapshot.snapshotId,
    contentHash: remote.activeEnvelope.snapshot.contentHash,
  }, null, 2))
}

try {
  const options = parseArgs(process.argv.slice(2))
  if (!options.command || options.command === '--help' || options.command === 'help') {
    console.log(usage())
    process.exit(0)
  }
  const core = loadCore()
  if (options.command === 'validate')
    validate(options, core)
  else if (options.command === 'draft')
    console.log(JSON.stringify(saveDraft(options, core), null, 2))
  else if (options.command === 'seed')
    seed(options, core)
  else if (options.command === 'diff')
    console.log(JSON.stringify(draftDiff(options), null, 2))
  else if (options.command === 'request-approval')
    console.log(JSON.stringify(requestApproval(options), null, 2))
  else if (options.command === 'approve')
    console.log(JSON.stringify(approveRelease(options), null, 2))
  else if (options.command === 'queue')
    console.log(JSON.stringify(queueDevelopmentRelease(options), null, 2))
  else if (options.command === 'rollback-approval')
    console.log(JSON.stringify(requestRollback(options), null, 2))
  else if (options.command === 'release-export')
    console.log(JSON.stringify(releaseExport(options, core), null, 2))
  else if (options.command === 'verify-release')
    console.log(JSON.stringify(verifyRelease(options, core), null, 2))
  else if (options.command === 'record-ci')
    console.log(JSON.stringify(recordCiProgress(options), null, 2))
  else if (options.command === 'record-deployment')
    console.log(JSON.stringify(recordDeployment(options), null, 2))
  else if (options.command === 'export')
    exportRegistry(options, core)
  else if (options.command === 'compare')
    compare(options, core)
  else
    throw new Error(`Unknown command: ${options.command}`)
}
catch (error) {
  console.error(error.message)
  console.error(usage())
  process.exitCode = 1
}
