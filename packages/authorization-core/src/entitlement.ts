import { Buffer } from 'node:buffer'
import {
  createPrivateKey,
  createPublicKey,
  KeyObject,
  sign,
  verify,
} from 'node:crypto'

import { AuthorizationError } from './index'

const ALG = 'EdDSA'
const TYPE = 'ylf-entitlement+jwt'

type KeyInput = KeyObject | Record<string, string> | string

export interface EntitlementClaims {
  iss: string
  sub: string
  aud: string
  app_id: string
  scope: readonly string[]
  cnf: { jkt: string }
  membership?: {
    level: string
    expires_at: number
  }
  iat: number
  nbf: number
  exp: number
  jti: string
}

function privateKey(input: KeyInput): KeyObject {
  if (typeof input === 'string')
    return createPrivateKey(input)
  if (input instanceof KeyObject)
    return input
  return createPrivateKey({ key: input, format: 'jwk' } as never)
}

function publicKey(input: KeyInput): KeyObject {
  if (typeof input === 'string')
    return createPublicKey(input)
  if (input instanceof KeyObject)
    return input.type === 'private' ? createPublicKey(input) : input
  return createPublicKey({ key: input, format: 'jwk' } as never)
}

function jsonSegment(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function parseSegment(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('not an object')
    return parsed
  }
  catch {
    throw new AuthorizationError('entitlement_invalid')
  }
}

export function createEntitlementKeyring(options: {
  issuer: string
  active: { kid: string, privateKey: KeyInput }
  verificationKeys: readonly { kid: string, publicKey: KeyInput }[]
  generateJti: () => string
}) {
  const signingKey = privateKey(options.active.privateKey)
  const keys = new Map<string, ReturnType<typeof publicKey>>([
    [options.active.kid, publicKey(signingKey)],
    ...options.verificationKeys.map(key => [key.kid, publicKey(key.publicKey)] as const),
  ])

  return {
    signMembershipEntitlement(input: {
      subject: string
      clientId: string
      appId: string
      scopes: readonly string[]
      deviceJkt: string
      membership?: { level: string, expiresAt: number } | null
      now: number
      ttlSeconds: number
    }): string {
      const nowSeconds = Math.floor(input.now / 1000)
      const claims: EntitlementClaims = {
        iss: options.issuer,
        sub: input.subject,
        aud: input.clientId,
        app_id: input.appId,
        scope: [...input.scopes],
        cnf: { jkt: input.deviceJkt },
        ...(input.membership && input.membership.expiresAt > input.now
          ? {
              membership: {
                level: input.membership.level,
                expires_at: Math.floor(input.membership.expiresAt / 1000),
              },
            }
          : {}),
        iat: nowSeconds,
        nbf: nowSeconds,
        exp: nowSeconds + input.ttlSeconds,
        jti: options.generateJti(),
      }
      const header = jsonSegment({ alg: ALG, typ: TYPE, kid: options.active.kid })
      const payload = jsonSegment(claims)
      const signingInput = `${header}.${payload}`
      const signature = sign(null, Buffer.from(signingInput), signingKey).toString('base64url')
      return `${signingInput}.${signature}`
    },

    verifyEntitlement(token: string, input: {
      audience: string
      deviceJkt: string
      now: number
      clockSkewSeconds?: number
    }): EntitlementClaims {
      const parts = token.split('.')
      if (parts.length !== 3)
        throw new AuthorizationError('entitlement_invalid')
      const [encodedHeader, encodedClaims, encodedSignature] = parts
      const header = parseSegment(encodedHeader)
      if (header.alg !== ALG || header.typ !== TYPE || typeof header.kid !== 'string')
        throw new AuthorizationError('entitlement_invalid')
      const verificationKey = keys.get(header.kid)
      if (!verificationKey)
        throw new AuthorizationError('entitlement_key_unknown')
      if (!verify(
        null,
        Buffer.from(`${encodedHeader}.${encodedClaims}`),
        verificationKey,
        Buffer.from(encodedSignature, 'base64url'),
      )) {
        throw new AuthorizationError('entitlement_signature_invalid')
      }

      const claims = parseSegment(encodedClaims) as unknown as EntitlementClaims
      const nowSeconds = Math.floor(input.now / 1000)
      const skew = input.clockSkewSeconds ?? 60
      if (claims.iss !== options.issuer
        || claims.aud !== input.audience
        || claims.cnf?.jkt !== input.deviceJkt
        || typeof claims.nbf !== 'number'
        || claims.nbf - skew > nowSeconds
        || typeof claims.exp !== 'number'
        || claims.exp + skew <= nowSeconds) {
        throw new AuthorizationError('entitlement_claims_invalid')
      }
      return claims
    },

    publicJwks() {
      return {
        keys: [...keys].map(([kid, key]) => ({
          ...key.export({ format: 'jwk' }),
          use: 'sig',
          alg: ALG,
          kid,
        })),
      }
    },
  }
}
