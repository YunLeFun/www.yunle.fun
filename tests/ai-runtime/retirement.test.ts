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

  it('moves account ledger and resource administration to YunLeFun/api', async () => {
    for (const path of [
      'cloudfunctions/account-api',
      'scripts/ensure-ai-runtime-resources.mjs',
      'scripts/lib/ai-runtime-resource-plan.mjs',
    ]) {
      await expect(stat(resolve(root, path))).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })
})
