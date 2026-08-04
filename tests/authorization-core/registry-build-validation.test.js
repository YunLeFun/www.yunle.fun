import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'
import { validateGeneratedRegistryArtifacts } from '../../packages/authorization-core/scripts/validate-generated.mjs'
import { parseGeneratedRegistryArtifact } from '../../packages/authorization-core/src/index'

function generatedArtifacts() {
  const directory = resolve(import.meta.dirname, '../../packages/authorization-core/src/generated')
  return Object.fromEntries(['development', 'production'].map(environment => [
    environment,
    JSON.parse(readFileSync(resolve(directory, `${environment}-registry.json`), 'utf8')),
  ]))
}

describe('registry generated build validation', () => {
  it('strictly parses every checked-in artifact and rejects malformed input', () => {
    const artifacts = generatedArtifacts()
    expect(() => validateGeneratedRegistryArtifacts(artifacts, parseGeneratedRegistryArtifact)).not.toThrow()

    expect(() => validateGeneratedRegistryArtifacts({
      ...artifacts,
      production: { ...artifacts.production, unexpected: true },
    }, parseGeneratedRegistryArtifact)).toThrow(expect.objectContaining({
      code: 'registry_unknown_field',
    }))
  })
})
