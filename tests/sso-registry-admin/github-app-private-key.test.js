import { Buffer } from 'node:buffer'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import {
  normalizeGitHubAppPrivateKey,
  writeGitHubActionsPrivateKey,
} from '../../scripts/normalize-github-app-private-key.mjs'

describe('registry release GitHub App private key normalization', () => {
  const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
    .privateKey
    .export({ format: 'pem', type: 'pkcs1' })
    .toString()
  const normalized = normalizeGitHubAppPrivateKey(privateKey)

  it('accepts PEM, escaped PEM and base64-encoded PEM', () => {
    expect(normalizeGitHubAppPrivateKey(privateKey)).toBe(normalized)
    expect(normalizeGitHubAppPrivateKey(privateKey.replace(/\n/g, '\\n'))).toBe(normalized)
    expect(normalizeGitHubAppPrivateKey(Buffer.from(privateKey).toString('base64'))).toBe(normalized)
  })

  it('rejects missing, malformed and non-RSA private keys', () => {
    const ed25519 = generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' })

    expect(() => normalizeGitHubAppPrivateKey('')).toThrow('must be configured')
    expect(() => normalizeGitHubAppPrivateKey('not-a-private-key')).toThrow('must be an RSA PEM')
    expect(() => normalizeGitHubAppPrivateKey(ed25519)).toThrow('must be an RSA PEM')
  })

  it('writes one masked escaped line to the GitHub Actions output file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'github-app-key-'))
    const outputPath = join(directory, 'output')
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    try {
      writeGitHubActionsPrivateKey(Buffer.from(privateKey).toString('base64'), outputPath)

      expect(readFileSync(outputPath, 'utf8')).toBe(`private-key=${normalized}\n`)
      expect(write).toHaveBeenCalledExactlyOnceWith(`::add-mask::${normalized}\n`)
    }
    finally {
      write.mockRestore()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
