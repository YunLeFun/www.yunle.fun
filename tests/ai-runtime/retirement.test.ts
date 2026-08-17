import { readFile, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')

describe('legacy ai runtime retirement boundary', () => {
  it('removes the service while preserving the frozen v1 compatibility baseline', async () => {
    await expect(stat(resolve(root, 'services/advjs-ai-runtime')))
      .rejects
      .toMatchObject({ code: 'ENOENT' })
    await expect(stat(resolve(root, 'tests/fixtures/ai-runtime/agent-runtime-v1.json')))
      .resolves
      .toMatchObject({ isFile: expect.any(Function) })
    await expect(stat(resolve(root, 'tests/fixtures/ai-runtime/v1.ts')))
      .resolves
      .toMatchObject({ isFile: expect.any(Function) })

    const verifier = await readFile(resolve(root, 'scripts/verify-ai-runtime-platform-p4.mjs'), 'utf8')
    expect(verifier).toContain('legacyRuntimeRetired: true')
    expect(verifier).toContain('legacyContractPreserved: true')
    expect(verifier).toContain('production-read-only')
    expect(verifier).not.toContain('services/advjs-ai-runtime/src')
  })

  it('keeps shared CloudBase resource drift and rollback guards', async () => {
    const resourceGuard = await readFile(resolve(root, 'scripts/ensure-ai-runtime-resources.mjs'), 'utf8')
    const resourcePlan = await readFile(resolve(root, 'scripts/lib/ai-runtime-resource-plan.mjs'), 'utf8')
    expect(resourceGuard).toContain('CREATE_YUNLEFUN_AI_RUNTIME_RESOURCES')
    expect(resourceGuard).toContain('PROVISION_YUNLEFUN_AI_RUNTIME_PRODUCTION')
    expect(resourcePlan).toContain('index_definition_mismatch')
    expect(resourcePlan).toContain('never_auto_delete_collection')
  })
})
