import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import process from 'node:process'

// Local proposal only: no network, signing, management-plane writes or deploy.
const require = createRequire(import.meta.url)
const { parseClientRegistrySnapshot } = require('../packages/authorization-core/dist/index.js')

const [environment, policyVersion] = process.argv.slice(2)
if (!['production', 'development'].includes(environment) || !policyVersion)
  throw new Error('Usage: node scripts/prepare-cms-desktop-registry.mjs <production|development> <new-policy-version>')

const artifact = JSON.parse(readFileSync(new URL(`../packages/authorization-core/src/generated/${environment}-registry.json`, import.meta.url), 'utf8'))
const client = JSON.parse(readFileSync(new URL('../specs/sso-client-registry-platform/changes/2026-09-22-cms-desktop.client.json', import.meta.url), 'utf8'))
if (artifact.registry.clients.some(entry => entry.clientId === client.clientId))
  throw new Error('cms-desktop is already registered; review the existing client instead of replacing it')
if (policyVersion === artifact.registry.policyVersion)
  throw new Error('A new policy version is required')
const snapshot = parseClientRegistrySnapshot({
  ...artifact.registry,
  policyVersion,
  clients: [...artifact.registry.clients, client],
}, { environment })
process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`)
