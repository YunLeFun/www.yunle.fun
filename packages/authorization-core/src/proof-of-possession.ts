import { Buffer } from 'node:buffer'
import { createHash, createPublicKey, verify } from 'node:crypto'

import { AuthorizationError } from './index'

export interface DevicePublicJwk {
  kty: 'EC'
  crv: 'P-256'
  x: string
  y: string
  [key: string]: unknown
}

export interface VerifiedProof {
  jti: string
  jkt: string
  publicJwk: DevicePublicJwk
}

function parseObject(segment: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('not an object')
    return parsed
  }
  catch {
    throw new AuthorizationError('proof_invalid')
  }
}

function assertDeviceJwk(value: unknown): DevicePublicJwk {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AuthorizationError('device_key_invalid')
  const jwk = value as Record<string, unknown>
  if (jwk.kty !== 'EC'
    || jwk.crv !== 'P-256'
    || typeof jwk.x !== 'string'
    || !jwk.x
    || typeof jwk.y !== 'string'
    || !jwk.y
    || 'd' in jwk) {
    throw new AuthorizationError('device_key_invalid')
  }
  return jwk as DevicePublicJwk
}

export function deviceJwkThumbprint(value: unknown): string {
  const jwk = assertDeviceJwk(value)
  return createHash('sha256').update(JSON.stringify({
    crv: jwk.crv,
    kty: jwk.kty,
    x: jwk.x,
    y: jwk.y,
  })).digest('base64url')
}

export function createProofOfPossessionVerifier(options: {
  maxAgeSeconds?: number
} = {}) {
  const maxAgeSeconds = options.maxAgeSeconds ?? 300
  return {
    verify(proof: string, input: {
      method: string
      url: string
      now: number
    }): VerifiedProof {
      const parts = typeof proof === 'string' ? proof.split('.') : []
      if (parts.length !== 3)
        throw new AuthorizationError('proof_invalid')
      const [encodedHeader, encodedClaims, encodedSignature] = parts
      const header = parseObject(encodedHeader)
      if (header.alg !== 'ES256' || String(header.typ).toLowerCase() !== 'dpop+jwt')
        throw new AuthorizationError('proof_invalid')

      const publicJwk = assertDeviceJwk(header.jwk)
      let valid = false
      try {
        valid = verify(
          'sha256',
          Buffer.from(`${encodedHeader}.${encodedClaims}`),
          {
            key: createPublicKey({ key: publicJwk, format: 'jwk' }),
            dsaEncoding: 'ieee-p1363',
          },
          Buffer.from(encodedSignature, 'base64url'),
        )
      }
      catch {
        throw new AuthorizationError('proof_invalid')
      }
      if (!valid)
        throw new AuthorizationError('proof_invalid')

      const claims = parseObject(encodedClaims)
      if (claims.htm !== input.method.toUpperCase() || claims.htu !== input.url)
        throw new AuthorizationError('proof_target_invalid')
      if (typeof claims.iat !== 'number'
        || !Number.isSafeInteger(claims.iat)
        || Math.abs(Math.floor(input.now / 1000) - claims.iat) > maxAgeSeconds) {
        throw new AuthorizationError('proof_expired')
      }
      if (typeof claims.jti !== 'string' || claims.jti.length < 16 || claims.jti.length > 200)
        throw new AuthorizationError('proof_invalid')

      return {
        jti: claims.jti,
        jkt: deviceJwkThumbprint(publicJwk),
        publicJwk,
      }
    },
  }
}
