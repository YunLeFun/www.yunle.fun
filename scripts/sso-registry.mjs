#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

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
  node scripts/sso-registry.mjs seed --environment <env> --operator <id> --reason <text> [--apply]
  node scripts/sso-registry.mjs export --environment <env> --operator <id> --reason <text> [--output <file>]
  node scripts/sso-registry.mjs compare --environment <env> --operator <id> --reason <text>

seed is dry-run unless --apply is present. export prints to stdout unless --output is present.`
}

function parseArgs(argv) {
  const [command, positional, ...rest] = argv
  const options = { command, positional, apply: false }
  const tokens = command === 'validate' ? rest : [positional, ...rest].filter(Boolean)
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

function parseCliJson(output) {
  const trimmed = output.trim()
  const firstObject = trimmed.indexOf('{')
  const lastObject = trimmed.lastIndexOf('}')
  const candidates = [
    trimmed,
    firstObject >= 0 && lastObject > firstObject ? trimmed.slice(firstObject, lastObject + 1) : '',
    ...trimmed.split(/\r?\n/).reverse(),
  ]
  for (const candidate of candidates) {
    if (!candidate.startsWith('{') && !candidate.startsWith('['))
      continue
    try {
      return JSON.parse(candidate)
    }
    catch (error) {
      void error
    }
  }
  throw new Error('CloudBase CLI returned no JSON result')
}

function unwrapFunctionResult(value) {
  let current = value
  for (let depth = 0; depth < 4; depth++) {
    if (typeof current === 'string') {
      try {
        current = JSON.parse(current)
        continue
      }
      catch {
        break
      }
    }
    if (current && typeof current === 'object' && ('result' in current || 'Result' in current)) {
      current = current.result ?? current.Result
      continue
    }
    if (current && typeof current === 'object' && ('response' in current || 'Response' in current)) {
      current = current.response ?? current.Response
      continue
    }
    if (current && typeof current === 'object' && 'data' in current && !('ok' in current)) {
      current = current.data
      continue
    }
    break
  }
  if (!current || typeof current !== 'object')
    throw new Error('Registry admin returned an invalid result')
  if (current.ok === false)
    throw new Error(`Registry admin rejected the request: ${current.error || 'unknown_error'}`)
  return current.ok === true ? current.data : current
}

function invokeAdmin(targetEnvironment, action, payload) {
  const output = run('pnpm', [
    '--package=@cloudbase/cli@3.6.4',
    'dlx',
    'tcb',
    '--config-file',
    ENV_CONFIGS[targetEnvironment],
    'fn',
    'invoke',
    'sso-registry-admin',
    '--data',
    JSON.stringify({ action, ...payload }),
    '--json',
  ], { capture: true })
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

function seed(options, core) {
  const targetEnvironment = environment(options.environment)
  const metadata = managementMetadata(options, 'initial Registry seed')
  const artifact = core.parseGeneratedRegistryArtifact(readJson(GENERATED_PATHS[targetEnvironment]), targetEnvironment)
  const payload = {
    ...metadata,
    baseSnapshotId: null,
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

function fetchVerifiedEnvelope(options, core) {
  const targetEnvironment = environment(options.environment)
  const metadata = managementMetadata(options, 'Registry snapshot read')
  const envelope = invokeAdmin(targetEnvironment, 'getActiveEnvelope', metadata)
  return core.verifyRegistryActiveEnvelope(envelope, {
    environment: targetEnvironment,
    trustAnchors: core.registryTrustAnchors,
  })
}

function exportedArtifact(options, core) {
  const targetEnvironment = environment(options.environment)
  const envelope = fetchVerifiedEnvelope(options, core)
  return {
    formatVersion: 1,
    environment: targetEnvironment,
    minimumGeneration: envelope.state.generation,
    registry: envelope.snapshot.registry,
    activeEnvelope: envelope,
  }
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
  else if (options.command === 'seed')
    seed(options, core)
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
