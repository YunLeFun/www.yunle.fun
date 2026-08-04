import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'
import { validateGeneratedRegistryArtifacts } from '../../packages/authorization-core/scripts/validate-generated.mjs'
import { parseGeneratedRegistryArtifact } from '../../packages/authorization-core/src/index'
import { buildCloudFunctionArtifacts } from '../../scripts/build-cloud-function.mjs'

const artifactFunctionNames = ['desktop-auth', 'sso-ticket']
const artifacts = new Map()

function generatedArtifacts() {
  const directory = resolve(import.meta.dirname, '../../packages/authorization-core/src/generated')
  return Object.fromEntries(['development', 'production'].map(environment => [
    environment,
    JSON.parse(readFileSync(resolve(directory, `${environment}-registry.json`), 'utf8')),
  ]))
}

describe('registry generated build validation', () => {
  beforeAll(() => {
    const artifactPaths = buildCloudFunctionArtifacts(artifactFunctionNames)
    artifactFunctionNames.forEach((functionName, index) => {
      artifacts.set(functionName, artifactPaths[index])
    })
  }, 30_000)

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

  it.each(artifactFunctionNames)(
    'keeps Registry shadow database adapters out of the %s artifact',
    (functionName) => {
      const artifact = artifacts.get(functionName)
      const manifest = JSON.parse(readFileSync(resolve(artifact, 'package.json'), 'utf8'))

      expect(manifest.dependencies).not.toHaveProperty('@yunlefun/cloudbase-registry-shadow')
      expect(existsSync(resolve(artifact, 'vendor/cloudbase-registry-shadow'))).toBe(false)
    },
  )
})
