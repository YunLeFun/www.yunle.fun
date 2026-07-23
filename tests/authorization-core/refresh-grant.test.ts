import type {
  AuthorizationError,
} from '../../packages/authorization-core/src/index'

import { describe, expect, it } from 'vitest'
import {
  createRefreshGrantMachine,
} from '../../packages/authorization-core/src/index'

describe('refresh grant rotation', () => {
  it('rotates hash-only tokens within idle and absolute lifetimes and detects reuse', () => {
    const tokens = ['R'.repeat(43), 'S'.repeat(43)]
    const refresh = createRefreshGrantMachine({
      generateToken: () => tokens.shift()!,
      idleSeconds: 30 * 24 * 60 * 60,
      absoluteSeconds: 180 * 24 * 60 * 60,
    })
    const issued = refresh.issue({
      grantId: 'grant-1',
      subject: 'user-1',
      issuer: 'https://www.yunle.fun',
      clientId: 'skykeeper-desktop',
      appId: 'skykeeper',
      scopes: ['membership:read'],
      deviceId: 'device-jkt',
      deviceJkt: 'device-jkt',
      registrationFingerprint: 'f'.repeat(64),
      now: 1_000,
    })

    expect(issued).toMatchObject({
      refreshToken: 'R'.repeat(43),
      record: {
        status: 'active',
        grantId: 'grant-1',
        idleExpiresAt: 2_592_001_000,
        absoluteExpiresAt: 15_552_001_000,
      },
    })
    expect(issued.record).not.toHaveProperty('refreshToken')

    const rotated = refresh.rotate(issued.record, {
      refreshToken: 'R'.repeat(43),
      proofJkt: 'device-jkt',
      now: 2_000,
    })
    expect(rotated).toMatchObject({
      refreshToken: 'S'.repeat(43),
      previous: {
        status: 'used',
        usedAt: 2_000,
      },
      next: {
        status: 'active',
        absoluteExpiresAt: 15_552_001_000,
        idleExpiresAt: 2_592_002_000,
      },
    })

    expect(() => refresh.rotate(rotated.previous, {
      refreshToken: 'R'.repeat(43),
      proofJkt: 'device-jkt',
      now: 3_000,
    })).toThrowError(expect.objectContaining<Partial<AuthorizationError>>({
      code: 'refresh_reused',
    }))
  })
})
