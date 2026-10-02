import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')

describe('shared account-api ownership', () => {
  it('has no account implementation or deployment definition in www', () => {
    expect(existsSync(resolve(root, 'cloudfunctions/account-api'))).toBe(false)
    for (const name of ['cloudbaserc.json', 'cloudbaserc.sso-development.json', 'cloudbaserc.test-accounts-development.json']) {
      const config = JSON.parse(readFileSync(resolve(root, name), 'utf8'))
      expect(config.functions.some((fn: { name: string }) => fn.name === 'account-api')).toBe(false)
    }
    const rejected = spawnSync(process.execPath, ['scripts/deploy-function.mjs', 'account-api'], { cwd: root, encoding: 'utf8', env: {} })
    expect(rejected.status).not.toBe(0)
    expect(rejected.stderr).toContain('account-api 已迁至 YunLeFun/api')
  })

  it('pins the shared reward ticket protocol used by the Nuxt signer', () => {
    const directory = resolve(root, 'server/vendor/account-api')
    const manifest = JSON.parse(readFileSync(resolve(directory, 'source.json'), 'utf8'))
    expect(manifest.repository).toBe('YunLeFun/api')
    for (const [file, digest] of Object.entries(manifest.files)) {
      expect(createHash('sha256').update(readFileSync(resolve(directory, file))).digest('hex')).toBe(digest)
    }
  })
})
