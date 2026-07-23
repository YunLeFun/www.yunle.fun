import { describe, expect, it } from 'vitest'

import { createDesktopClientRegistry } from '../../cloudfunctions/desktop-auth/lib/client-registry.js'

describe('desktop client registry adapter', () => {
  const registry = createDesktopClientRegistry({ issuerEnvironment: 'production' })

  it('derives appId and the exact allowed scopes from clientId', () => {
    expect(registry.authorize({
      clientId: 'skykeeper-desktop',
      scopes: ['membership:read'],
    })).toMatchObject({
      issuer: 'https://www.yunle.fun',
      clientId: 'skykeeper-desktop',
      appId: 'skykeeper',
      consent: 'explicit',
      scopes: ['membership:read'],
    })
  })

  it('rejects unknown clients, omitted scopes and undeclared scopes', () => {
    expect(() => registry.authorize({
      clientId: 'unregistered-desktop',
      scopes: ['membership:read'],
    })).toThrowError(expect.objectContaining({ code: 'client_unknown' }))
    expect(() => registry.authorize({
      clientId: 'skykeeper-desktop',
      scopes: [],
    })).toThrowError(expect.objectContaining({ code: 'invalid_scope' }))
    expect(() => registry.authorize({
      clientId: 'skykeeper-desktop',
      scopes: ['coin'],
    })).toThrowError(expect.objectContaining({ code: 'invalid_scope' }))
  })
})
