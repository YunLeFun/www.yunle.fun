import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'
import { validateGeneratedRegistryArtifacts } from '../../packages/authorization-core/scripts/validate-generated.mjs'
import { parseGeneratedRegistryArtifact } from '../../packages/authorization-core/src/index'
import { buildCloudFunctionArtifact } from '../../scripts/build-cloud-function.mjs'

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

  it.each(['desktop-auth', 'sso-ticket'])(
    'keeps Registry shadow database adapters out of the %s artifact',
    (functionName) => {
      const artifact = buildCloudFunctionArtifact(functionName)
      const manifest = JSON.parse(readFileSync(resolve(artifact, 'package.json'), 'utf8'))

      expect(manifest.dependencies).not.toHaveProperty('@yunlefun/cloudbase-registry-shadow')
      expect(existsSync(resolve(artifact, 'vendor/cloudbase-registry-shadow'))).toBe(false)
    },
  )
})
