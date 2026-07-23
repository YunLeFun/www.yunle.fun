import { Buffer } from 'node:buffer'
import { createHash, timingSafeEqual } from 'node:crypto'

import { AuthorizationError } from './index'

export interface RefreshTokenRecord {
  status: 'active' | 'revoked' | 'used'
  tokenHash: string
  grantId: string
  subject: string
  issuer: string
  clientId: string
  appId: string
  scopes: readonly string[]
  deviceId: string
  deviceJkt: string
  registrationFingerprint: string
  createdAt: number
  issuedAt: number
  idleExpiresAt: number
  absoluteExpiresAt: number
  usedAt?: number
  revokedAt?: number
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function equal(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

export function createRefreshGrantMachine(options: {
  generateToken: () => string
  idleSeconds: number
  absoluteSeconds: number
}) {
  return {
    issue(input: Omit<RefreshTokenRecord, 'absoluteExpiresAt' | 'createdAt' | 'idleExpiresAt' | 'issuedAt' | 'status' | 'tokenHash'> & { now: number }) {
      const refreshToken = options.generateToken()
      const record: RefreshTokenRecord = {
        status: 'active',
        tokenHash: hash(refreshToken),
        grantId: input.grantId,
        subject: input.subject,
        issuer: input.issuer,
        clientId: input.clientId,
        appId: input.appId,
        scopes: [...input.scopes],
        deviceId: input.deviceId,
        deviceJkt: input.deviceJkt,
        registrationFingerprint: input.registrationFingerprint,
        createdAt: input.now,
        issuedAt: input.now,
        idleExpiresAt: input.now + options.idleSeconds * 1000,
        absoluteExpiresAt: input.now + options.absoluteSeconds * 1000,
      }
      return { refreshToken, record }
    },

    rotate(record: RefreshTokenRecord, input: {
      refreshToken: string
      proofJkt: string
      now: number
    }) {
      if (record.status === 'used')
        throw new AuthorizationError('refresh_reused')
      if (record.status === 'revoked')
        throw new AuthorizationError('grant_revoked')
      if (!equal(record.tokenHash, hash(input.refreshToken)) || record.deviceJkt !== input.proofJkt)
        throw new AuthorizationError('refresh_binding_invalid')
      if (record.idleExpiresAt <= input.now || record.absoluteExpiresAt <= input.now)
        throw new AuthorizationError('refresh_expired')

      const refreshToken = options.generateToken()
      return {
        refreshToken,
        previous: {
          ...record,
          status: 'used' as const,
          usedAt: input.now,
        },
        next: {
          ...record,
          status: 'active' as const,
          tokenHash: hash(refreshToken),
          issuedAt: input.now,
          idleExpiresAt: Math.min(
            input.now + options.idleSeconds * 1000,
            record.absoluteExpiresAt,
          ),
          usedAt: undefined,
        },
      }
    },
  }
}
