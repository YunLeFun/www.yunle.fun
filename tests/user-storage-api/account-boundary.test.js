import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function readRepoFile(path) {
  return readFileSync(resolve(rootDir, path), 'utf8')
}

describe('user-storage-api storage implementation sync', () => {
  it('keeps storage actions out of account-api', () => {
    const accountApiIndex = readRepoFile('cloudfunctions/account-api/index.js')
    const legacyStoragePath = resolve(rootDir, 'cloudfunctions/account-api/storage.js')
    const storageActions = [
      'getStorageQuota',
      'reserveStorageUpload',
      'finalizeStorageUpload',
      'listStorageFiles',
      'deleteStorageFile',
      'downloadStorageFile',
    ]

    expect(existsSync(legacyStoragePath)).toBe(false)
    expect(accountApiIndex).not.toContain('require(\'./storage\')')
    for (const action of storageActions)
      expect(accountApiIndex).not.toContain(`case '${action}'`)
  })
})
