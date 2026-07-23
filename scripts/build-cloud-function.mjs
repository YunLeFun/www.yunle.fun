#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ARTIFACT_ROOT = resolve(ROOT, '.cloudbase/artifacts')
const CORE_FUNCTIONS = new Set(['desktop-auth', 'sso-ticket'])

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  })
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(' ')} failed`)
}

function copyAuthorizationCore(artifactDirectory) {
  const source = resolve(ROOT, 'packages/authorization-core')
  const vendor = join(artifactDirectory, 'vendor/authorization-core')
  mkdirSync(vendor, { recursive: true })
  cpSync(join(source, 'dist'), join(vendor, 'dist'), { recursive: true })

  const packageJson = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
  writeFileSync(join(vendor, 'package.json'), `${JSON.stringify({
    name: packageJson.name,
    version: packageJson.version,
    private: true,
    type: packageJson.type,
    main: packageJson.main,
  }, null, 2)}\n`)
}

export function buildCloudFunctionArtifact(functionName) {
  if (!CORE_FUNCTIONS.has(functionName))
    return resolve(ROOT, 'cloudfunctions', functionName)

  const source = resolve(ROOT, 'cloudfunctions', functionName)
  if (!existsSync(source))
    throw new Error(`unknown cloud function: ${functionName}`)

  run('pnpm', ['build:authorization-core'])

  const artifact = resolve(ARTIFACT_ROOT, functionName)
  rmSync(artifact, { recursive: true, force: true })
  mkdirSync(artifact, { recursive: true })
  cpSync(source, artifact, {
    recursive: true,
    filter: path => !path.split('/').includes('node_modules'),
  })
  copyAuthorizationCore(artifact)

  const manifestPath = join(artifact, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.dependencies['@yunlefun/authorization-core'] = 'file:vendor/authorization-core'
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return artifact
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const functions = process.argv.slice(2)
  if (!functions.length)
    throw new Error('usage: node scripts/build-cloud-function.mjs <function...>')
  for (const functionName of functions)
    console.log(buildCloudFunctionArtifact(functionName))
}
