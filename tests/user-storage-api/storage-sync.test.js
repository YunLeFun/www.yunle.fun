import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function readRepoFile(path) {
  return readFileSync(resolve(rootDir, path), 'utf8')
}

describe('user-storage-api storage implementation sync', () => {
  it('keeps the legacy account-api storage implementation in lockstep', () => {
    expect(readRepoFile('cloudfunctions/account-api/storage.js'))
      .toBe(readRepoFile('cloudfunctions/user-storage-api/storage.js'))
  })
})
