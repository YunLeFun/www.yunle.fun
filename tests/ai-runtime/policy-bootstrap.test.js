import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')
const script = resolve(root, 'scripts/bootstrap-ai-runtime-policy.mjs')

describe('ai runtime policy bootstrap', () => {
  it('defaults to a no-network, fully disabled policy manifest', () => {
    const result = spawnSync(process.execPath, [script], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        TENCENTCLOUD_SECRETID: '',
        TENCENTCLOUD_SECRETKEY: '',
      },
    })
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toMatchObject({
      applied: false,
      mode: 'manifest',
      network: false,
      policy: {
        enabled: false,
        model: 'deepseek-v4-flash',
        modelEnabled: false,
        providerGroup: 'cloudbase',
      },
    })
    expect(Object.values(JSON.parse(result.stdout).policy.capabilities).every(value => value === false)).toBe(true)
  })

  it('rejects apply before any network access without exact confirmations', () => {
    const result = spawnSync(process.execPath, [script, '--apply'], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        TENCENTCLOUD_SECRETID: '',
        TENCENTCLOUD_SECRETKEY: '',
      },
    })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/env-id/)

    const productionWithoutGate = spawnSync(process.execPath, [
      script,
      '--apply',
      '--environment=production',
      '--env-id=yunlefun-prod-fixture-123456',
      '--confirm-env=yunlefun-prod-fixture-123456',
      '--confirm-write=BOOTSTRAP_DISABLED_ADVJS_AI_RUNTIME_POLICY',
    ], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        TENCENTCLOUD_SECRETID: '',
        TENCENTCLOUD_SECRETKEY: '',
      },
    })
    expect(productionWithoutGate.status).not.toBe(0)
    expect(productionWithoutGate.stderr).toMatch(/confirm-production/)
  })
})
