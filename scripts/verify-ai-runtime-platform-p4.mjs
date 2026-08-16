import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const expectedFixtureHash = '49e09a599a19c3c20e6e0afee1e3a6d9883cb0f77774302a150dab5c21477b86'
const wwwRoot = path.resolve(new URL('..', import.meta.url).pathname)

async function requiredRoot(name) {
  const value = process.env[name]
  if (!value || !path.isAbsolute(value))
    throw new Error(`${name} must be an absolute local checkout path`)
  await stat(value)
  return value
}

const apiRoot = await requiredRoot('YUNLEFUN_API_RUNTIME_ROOT')
const studioRoot = await requiredRoot('ADVJS_STUDIO_ROOT')

async function text(root, relative) {
  return readFile(path.join(root, relative), 'utf8')
}

async function bytes(root, relative) {
  return readFile(path.join(root, relative))
}

async function studioAgent(relative, encoding) {
  const candidates = [
    path.join(studioRoot, 'packages/agent/src', relative),
    path.join(studioRoot, 'apps/studio/src/agent', relative),
  ]
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, encoding)
    }
    catch (error) {
      if (error?.code !== 'ENOENT')
        throw error
    }
  }
  throw new Error(`ADV.JS Agent source is missing ${relative}`)
}

function assertContains(value, fragments, label) {
  for (const fragment of fragments) {
    if (!value.includes(fragment))
      throw new Error(`${label} is missing ${fragment}`)
  }
}

const fixtures = [
  ['www legacy Runtime', await bytes(wwwRoot, 'services/advjs-ai-runtime/src/contracts/fixtures/agent-runtime-v1.json')],
  ['API v1 Adapter', await bytes(apiRoot, 'packages/ai-runtime-advjs/src/contracts/fixtures/agent-runtime-v1.json')],
  ['ADV.JS Studio', await studioAgent('contracts/fixtures/agent-runtime-v1.json')],
]
for (const [label, value] of fixtures) {
  const hash = createHash('sha256').update(value).digest('hex')
  if (hash !== expectedFixtureHash)
    throw new Error(`${label} fixture drifted: ${hash}`)
}
if (!fixtures.slice(1).every(([, value]) => value.equals(fixtures[0][1])))
  throw new Error('Runtime, Adapter and Studio fixtures are not byte-identical')

const oldContract = await text(wwwRoot, 'services/advjs-ai-runtime/src/contracts/v1.ts')
const adapterContract = await text(apiRoot, 'packages/ai-runtime-advjs/src/contracts/v1.ts')
if (oldContract !== adapterContract)
  throw new Error('API v1 parser drifted from the frozen Runtime parser')

const oldApi = await text(wwwRoot, 'services/advjs-ai-runtime/src/api/runtime-api.ts')
const newHttp = await text(apiRoot, 'services/ai-runtime/src/handler.ts')
const newCompatibility = await text(apiRoot, 'packages/ai-runtime-advjs/src/compatibility/v1.ts')
const studioManaged = await studioAgent('managed/runtime.ts', 'utf8')
const studioTransport = await studioAgent('managed/transport.ts', 'utf8')
assertContains(oldApi, ['/v1/tasks', '/cancel', '/events'], 'old Runtime')
assertContains(newHttp, ['\\/v1\\/tasks', 'cancel|events'], 'API compatibility entry')
assertContains(studioManaged, ['/v1/tasks', '/cancel', '/events'], 'Studio managed transport')
assertContains(newCompatibility, ['toV1Cursor', 'toV2Cursor', 'proposal.ready'], 'API v1 projection')
assertContains(studioTransport, ['last-event-id', 'IDEMPOTENCY_CONFLICT', 'INVALID_CURSOR'], 'Studio transport')

const lifecycle = await text(wwwRoot, 'services/advjs-ai-runtime/src/production/lifecycle.ts')
const oldConfig = await text(wwwRoot, 'services/advjs-ai-runtime/src/production/config.ts')
assertContains(lifecycle, ['#runWorkerCycle', '#runSweepCycle'], 'legacy background lifecycle')
assertContains(oldConfig, ['\'ADVJS_AI_WORKER_POLL_MS\', 500', 'ADVJS_AI_ACCOUNT_API_TOKEN'], 'legacy Runtime configuration')

process.stdout.write(`${JSON.stringify({
  mode: 'local-only',
  network: false,
  applied: false,
  fixtureSha256: expectedFixtureHash,
  compared: fixtures.map(([label]) => label),
  legacyRuntimePreserved: true,
}, null, 2)}\n`)
