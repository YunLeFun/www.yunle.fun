import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { createAuthorizationCore, parseClientRegistrySnapshot } = require('../../packages/authorization-core/dist/index.js')

const client = JSON.parse(readFileSync(new URL('../../specs/sso-client-registry-platform/changes/2026-09-22-cms-desktop.client.json', import.meta.url), 'utf8'))

describe('cms-desktop local registration proposal (not released)', () => {
  for (const environment of ['production', 'development']) {
    it(`adds only the explicit device membership permission in ${environment}`, () => {
      const artifact = JSON.parse(readFileSync(new URL(`../../packages/authorization-core/src/generated/${environment}-registry.json`, import.meta.url), 'utf8'))
      // The same test must also pass after the approved proposal is exported by CI.
      const existing = artifact.registry.clients.find(entry => entry.clientId === 'cms-desktop')
      if (existing)
        expect(existing).toEqual(client)
      const registry = parseClientRegistrySnapshot({ ...artifact.registry, policyVersion: '2026-09-22.1', clients: existing ? artifact.registry.clients : [...artifact.registry.clients, client] }, { environment })
      const core = createAuthorizationCore({ registry })
      const request = { issuer: registry.issuer, clientId: 'cms-desktop', adapter: 'device', requestedScopes: ['membership:read'] }
      expect(core.authorize(request)).toMatchObject({ appId: 'cms', clientId: 'cms-desktop', consent: 'explicit', scopes: ['membership:read'] })
      for (const requestedScopes of [[], ['identity:bootstrap'], ['coin'], ['membership:read', 'coin']])
        expect(() => core.authorize({ ...request, requestedScopes })).toThrow()
      expect(() => core.authorize({ ...request, adapter: 'web-sso' })).toThrow()
      expect(registry.clients.filter(entry => entry.clientId !== 'cms-desktop')).toEqual(artifact.registry.clients.filter(entry => entry.clientId !== 'cms-desktop'))
    })
  }
})
