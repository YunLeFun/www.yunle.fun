import type {
  AuthorizationError,
} from '../../packages/authorization-core/src/index'

import { describe, expect, it } from 'vitest'
import {
  createAuthorizationCore,
} from '../../packages/authorization-core/src/index'

describe('authorization core client decisions', () => {
  it('derives the business app and exact scopes from a registered client', () => {
    const authorization = createAuthorizationCore({
      registry: {
        schemaVersion: 1,
        policyVersion: '2026-07-23.1',
        issuer: 'https://www.yunle.fun',
        clients: [
          {
            clientId: 'skykeeper-desktop',
            appId: 'skykeeper',
            displayName: 'Skykeeper',
            status: 'active',
            adapters: [
              {
                kind: 'device',
                consent: 'explicit',
                allowedScopes: ['membership:read'],
              },
            ],
          },
        ],
      },
    })

    expect(authorization.authorize({
      issuer: 'https://www.yunle.fun',
      clientId: 'skykeeper-desktop',
      adapter: 'device',
      requestedScopes: ['membership:read'],
    })).toEqual({
      issuer: 'https://www.yunle.fun',
      clientId: 'skykeeper-desktop',
      appId: 'skykeeper',
      displayName: 'Skykeeper',
      adapter: 'device',
      consent: 'explicit',
      scopes: ['membership:read'],
      policyVersion: '2026-07-23.1',
      registrationFingerprint: 'edd9c4e4489eda87b05c4101cd239865128bf0d107d3fa15e130dc828d10cf9a',
    })
  })

  it('returns a stable error when the client is not registered', () => {
    const authorization = createAuthorizationCore({
      registry: {
        schemaVersion: 1,
        policyVersion: '2026-07-23.1',
        issuer: 'https://www.yunle.fun',
        clients: [],
      },
    })

    expect(() => authorization.authorize({
      issuer: 'https://www.yunle.fun',
      clientId: 'unknown-desktop',
      adapter: 'device',
      requestedScopes: ['membership:read'],
    })).toThrowError(expect.objectContaining<Partial<AuthorizationError>>({
      name: 'AuthorizationError',
      code: 'client_unknown',
    }))
  })

  it('rejects duplicate client registrations when the registry is loaded', () => {
    const duplicate = {
      clientId: 'cms-web',
      appId: 'cms',
      displayName: 'Yunle CMS',
      status: 'active' as const,
      adapters: [
        {
          kind: 'web-sso' as const,
          consent: 'trusted' as const,
          allowedScopes: ['identity:bootstrap'],
        },
      ],
    }

    expect(() => createAuthorizationCore({
      registry: {
        schemaVersion: 1,
        policyVersion: '2026-07-23.1',
        issuer: 'https://www.yunle.fun',
        clients: [duplicate, { ...duplicate }],
      },
    })).toThrowError(expect.objectContaining<Partial<AuthorizationError>>({
      code: 'registry_invalid',
    }))
  })

  it('never grants registry scopes when the request omits scopes', () => {
    const authorization = createAuthorizationCore({
      registry: {
        schemaVersion: 1,
        policyVersion: '2026-07-23.1',
        issuer: 'https://www.yunle.fun',
        clients: [
          {
            clientId: 'skykeeper-desktop',
            appId: 'skykeeper',
            displayName: 'Skykeeper',
            status: 'active',
            adapters: [
              {
                kind: 'device',
                consent: 'explicit',
                allowedScopes: ['membership:read'],
              },
            ],
          },
        ],
      },
    })

    expect(() => authorization.authorize({
      issuer: 'https://www.yunle.fun',
      clientId: 'skykeeper-desktop',
      adapter: 'device',
      requestedScopes: [],
    })).toThrowError(expect.objectContaining<Partial<AuthorizationError>>({
      code: 'invalid_scope',
    }))
  })

  it('fails with policy errors for issuer, client status, and adapter mismatches', () => {
    const authorization = createAuthorizationCore({
      registry: {
        schemaVersion: 1,
        policyVersion: '2026-07-23.1',
        issuer: 'https://www.yunle.fun',
        clients: [{
          clientId: 'disabled-web',
          appId: 'disabled',
          displayName: 'Disabled',
          status: 'disabled',
          adapters: [{
            kind: 'web-sso',
            consent: 'trusted',
            allowedScopes: ['identity:bootstrap'],
            origins: ['https://disabled.yunle.fun'],
            redirectUris: ['https://disabled.yunle.fun/'],
          }],
        }, {
          clientId: 'device-only',
          appId: 'device-only',
          displayName: 'Device only',
          status: 'active',
          adapters: [{
            kind: 'device',
            consent: 'explicit',
            allowedScopes: ['membership:read'],
          }],
        }],
      },
    })

    const cases = [
      {
        expected: 'issuer_mismatch',
        request: {
          issuer: 'https://www.yunle.localhost:3000',
          clientId: 'device-only',
          adapter: 'device' as const,
          requestedScopes: ['membership:read'],
        },
      },
      {
        expected: 'client_unavailable',
        request: {
          issuer: 'https://www.yunle.fun',
          clientId: 'disabled-web',
          adapter: 'web-sso' as const,
          requestedScopes: ['identity:bootstrap'],
          origin: 'https://disabled.yunle.fun',
          redirectUri: 'https://disabled.yunle.fun/',
        },
      },
      {
        expected: 'adapter_not_allowed',
        request: {
          issuer: 'https://www.yunle.fun',
          clientId: 'device-only',
          adapter: 'web-sso' as const,
          requestedScopes: ['membership:read'],
          origin: 'https://device-only.yunle.fun',
          redirectUri: 'https://device-only.yunle.fun/',
        },
      },
    ]

    for (const { request, expected } of cases) {
      expect(() => authorization.authorize(request)).toThrowError(
        expect.objectContaining<Partial<AuthorizationError>>({ code: expected }),
      )
    }
  })
})
