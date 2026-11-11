import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import process from 'node:process'

// Offline proposal only. Publish through the existing Registry approval flow.
const require = createRequire(import.meta.url)
const { parseClientRegistrySnapshot } = require('../packages/authorization-core/dist/index.js')

const [environment, source, destination, policyVersion] = process.argv.slice(2)
if (!['production', 'development'].includes(environment) || !source || !destination || !policyVersion)
  throw new Error('Usage: node scripts/prepare-cms-theme-registry.mjs <production|development> <reviewed-current-registry.json> <new-proposal.json> <new-policy-version>')

const input = JSON.parse(await readFile(source, 'utf8'))
const current = parseClientRegistrySnapshot(input.registry ?? input, { environment })
if (policyVersion === current.policyVersion)
  throw new Error('A new policy version is required')
const client = current.clients.find(entry => entry.clientId === 'cms-desktop')
const device = client?.adapters.find(entry => entry.kind === 'device')
if (client?.appId !== 'cms' || client.status !== 'active' || device?.consent !== 'explicit')
  throw new Error('An active cms-desktop explicit-consent device adapter is required')
if (device.allowedScopes.includes('ai:theme'))
  throw new Error('ai:theme is already registered; review the current release instead')

const basePolicyVersion = current.policyVersion
device.allowedScopes.push('ai:theme')
current.policyVersion = policyVersion
const proposal = parseClientRegistrySnapshot(current, { environment })
await writeFile(destination, `${JSON.stringify(proposal, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify({
  environment,
  basePolicyVersion,
  policyVersion,
  clientCount: proposal.clients.length,
  addedScope: 'cms-desktop:ai:theme',
  signed: false,
  remoteWrites: false,
}))
