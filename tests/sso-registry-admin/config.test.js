import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { SSO_REGISTRY_COLLECTION_MANIFESTS } from '../../cloudfunctions/sso-registry-admin/store.js'

const root = resolve(import.meta.dirname, '../..')

function config(name) {
  return JSON.parse(readFileSync(resolve(root, name), 'utf8'))
}

describe('sso-registry-admin deployment contract', () => {
  it.each([
    ['cloudbaserc.json', 'production'],
    ['cloudbaserc.sso-development.json', 'development'],
  ])('declares a private Node 18 Event Function in %s', (file, expectedEnvironment) => {
    const manifest = config(file)
    const fn = manifest.functions.find(candidate => candidate.name === 'sso-registry-admin')
    expect(fn).toMatchObject({
      runtime: 'Nodejs18.15',
      handler: 'index.main',
      installDependency: true,
      aclRule: { invoke: false },
      envVariables: {
        SSO_REGISTRY_SIGNING_KEY: '{{env.SSO_REGISTRY_SIGNING_KEY}}',
        SSO_REGISTRY_SIGNING_KID: '{{env.SSO_REGISTRY_SIGNING_KID}}',
      },
    })
    expect(fn.triggers).toBeUndefined()
    expect(fn.envVariables.AUTH_ISSUER_ENVIRONMENT).toBe(
      expectedEnvironment === 'development'
        ? 'development'
        : '{{env.AUTH_ISSUER_ENVIRONMENT}}',
    )
  })

  it('keeps shadow mode explicitly disabled in checked-in deploy manifests', () => {
    const production = config('cloudbaserc.json')
    for (const name of ['desktop-auth', 'sso-ticket']) {
      expect(production.functions.find(fn => fn.name === name)?.envVariables)
        .toMatchObject({ SSO_REGISTRY_SHADOW_ENABLED: 'false' })
    }
    const development = config('cloudbaserc.sso-development.json')
    expect(development.functions.find(fn => fn.name === 'sso-ticket')?.envVariables)
      .toMatchObject({ SSO_REGISTRY_SHADOW_ENABLED: 'false' })
  })

  it('declares four ADMINONLY collections with the required unique sequence index', () => {
    expect(SSO_REGISTRY_COLLECTION_MANIFESTS.map(item => item.collection)).toEqual([
      'sso_registry_drafts',
      'sso_registry_snapshots',
      'sso_registry_state',
      'sso_registry_audit_logs',
    ])
    expect(SSO_REGISTRY_COLLECTION_MANIFESTS.every(item => item.access === 'ADMINONLY')).toBe(true)
    const snapshots = SSO_REGISTRY_COLLECTION_MANIFESTS.find(item => item.collection === 'sso_registry_snapshots')
    expect(snapshots.indexes).toContainEqual(expect.objectContaining({
      name: 'environment_sequence',
      unique: true,
    }))
  })
})
