import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const expectedFixtureHash = '49e09a599a19c3c20e6e0afee1e3a6d9883cb0f77774302a150dab5c21477b86'
const wwwRoot = path.resolve(new URL('..', import.meta.url).pathname)
const retiredRuntimeRoot = path.join(wwwRoot, 'services/advjs-ai-runtime')

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

async function assertMissing(target, label) {
  try {
    await stat(target)
  }
  catch (error) {
    if (error?.code === 'ENOENT')
      return
    throw error
  }
  throw new Error(`${label} must be retired: ${target}`)
}

await assertMissing(retiredRuntimeRoot, 'www legacy Runtime')

const fixtures = [
  ['www frozen v1 contract', await bytes(wwwRoot, 'tests/fixtures/ai-runtime/agent-runtime-v1.json')],
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

const frozenContract = await text(wwwRoot, 'tests/fixtures/ai-runtime/v1.ts')
const adapterContract = await text(apiRoot, 'packages/ai-runtime-advjs/src/contracts/v1.ts')
if (frozenContract !== adapterContract)
  throw new Error('API v1 parser drifted from the frozen www compatibility contract')

const newHttp = await text(apiRoot, 'services/ai-runtime/src/handler.ts')
const newCompatibility = await text(apiRoot, 'packages/ai-runtime-advjs/src/compatibility/v1.ts')
const productionPublic = await text(apiRoot, 'services/ai-runtime/src/production-public.ts')
const productionUnit = await text(apiRoot, 'services/ai-runtime/runtime.unit.json')
const studioManaged = await studioAgent('managed/runtime.ts', 'utf8')
const studioTransport = await studioAgent('managed/transport.ts', 'utf8')
assertContains(newHttp, ['\\/v1\\/tasks', 'cancel|events'], 'API compatibility entry')
assertContains(studioManaged, ['/v1/tasks', '/cancel', '/events'], 'Studio managed transport')
assertContains(newCompatibility, ['toV1Cursor', 'toV2Cursor', 'proposal.ready'], 'API v1 projection')
assertContains(studioTransport, ['last-event-id', 'IDEMPOTENCY_CONFLICT', 'INVALID_CURSOR'], 'Studio transport')
assertContains(
  productionPublic,
  ['CloudBaseNodeRuntimeDatabase', 'legacyTaskProjector', 'projectLegacyAdvjsTask'],
  'API production direct legacy reader',
)
assertContains(productionUnit, ['production-read-only', 'task and ledger data stay authoritative'], 'API rollback unit')
if (productionPublic.includes('LegacyReadProjectionClient'))
  throw new Error('Production Runtime must not depend on the retired www read-projection broker')

process.stdout.write(`${JSON.stringify({
  mode: 'local-only',
  network: false,
  applied: false,
  fixtureSha256: expectedFixtureHash,
  fixtureCompared: fixtures.map(([label]) => label),
  parserCompared: ['www frozen v1 contract', 'API v1 Adapter'],
  studioCompatibilityChecks: ['managed v1 routes', 'SSE cursor and error handling'],
  runtimeOwner: 'YunLeFun/api',
  legacyRuntimeRetired: true,
  legacyContractPreserved: true,
  rollbackOwner: 'YunLeFun/api production-read-only',
}, null, 2)}\n`)
