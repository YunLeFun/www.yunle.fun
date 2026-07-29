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
const TYPE = 'ylf-identity+jwt'
const MAX_TTL_SECONDS = 300

export type IdentityAssertionKeyInput = KeyObject | Record<string, string> | string

export interface IdentityAssertionClaims {
  iss: string
  sub: string
  aud: string
  app_id: string
  scope: readonly string[]
  nonce: string
  phone_number_verified: true
  account_status: 'active'
  iat: number
  nbf: number
  exp: number
  jti: string
}

export interface IdentityAssertionKeyringOptions {
  issuer: string
  active: { kid: string, privateKey: IdentityAssertionKeyInput }
  verificationKeys: readonly { kid: string, publicKey: IdentityAssertionKeyInput }[]
  generateJti: () => string
}

export interface SignIdentityAssertionInput {
  subject: string
  clientId: string
  appId: string
  scopes: readonly string[]
  nonce: string
  phoneNumberVerified: true
  accountStatus: 'active'
  now: number
  ttlSeconds: number
}

export interface VerifyIdentityAssertionInput {
  audience: string
  nonce: string
  now: number
  clockSkewSeconds?: number
}

export interface IdentityAssertionKeyring {
  signIdentityAssertion: (input: SignIdentityAssertionInput) => string
  verifyIdentityAssertion: (token: string, input: VerifyIdentityAssertionInput) => IdentityAssertionClaims
  publicJwks: () => { keys: Record<string, unknown>[] }
}

function privateKey(input: IdentityAssertionKeyInput): KeyObject {
  if (typeof input === 'string')
    return createPrivateKey(input)
  if (input instanceof KeyObject)
    return input
  return createPrivateKey({ key: input, format: 'jwk' } as never)
}

function publicKey(input: IdentityAssertionKeyInput): KeyObject {
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
    throw new AuthorizationError('identity_assertion_invalid')
  }
}

function validScopes(value: unknown): value is string[] {
  return Array.isArray(value)
    && value.length > 0
    && value.every(scope => typeof scope === 'string' && scope.length > 0)
}

/**
 * Creates the Ed25519 keyring used to issue and verify minimal Web SSO identity assertions.
 *
 * The assertion intentionally carries only verified admission facts and never a raw phone number.
 */
export function createIdentityAssertionKeyring(options: IdentityAssertionKeyringOptions): IdentityAssertionKeyring {
  const signingKey = privateKey(options.active.privateKey)
  const keys = new Map<string, ReturnType<typeof publicKey>>()
  keys.set(options.active.kid, publicKey(signingKey))
  for (const key of options.verificationKeys) {
    if (key.kid !== options.active.kid)
      keys.set(key.kid, publicKey(key.publicKey))
  }

  return {
    signIdentityAssertion(input) {
      if (input.phoneNumberVerified !== true
        || input.accountStatus !== 'active'
        || !input.subject
        || !input.clientId
        || !input.appId
        || !validScopes(input.scopes)
        || !input.nonce
        || !Number.isSafeInteger(input.ttlSeconds)
        || input.ttlSeconds < 30
        || input.ttlSeconds > MAX_TTL_SECONDS) {
        throw new AuthorizationError('identity_assertion_claims_invalid')
      }
      const nowSeconds = Math.floor(input.now / 1000)
      const jti = options.generateJti()
      if (!jti)
        throw new AuthorizationError('identity_assertion_claims_invalid')
      const claims: IdentityAssertionClaims = {
        iss: options.issuer,
        sub: input.subject,
        aud: input.clientId,
        app_id: input.appId,
        scope: [...input.scopes],
        nonce: input.nonce,
        phone_number_verified: true,
        account_status: 'active',
        iat: nowSeconds,
        nbf: nowSeconds,
        exp: nowSeconds + input.ttlSeconds,
        jti,
      }
      const header = jsonSegment({ alg: ALG, typ: TYPE, kid: options.active.kid })
      const payload = jsonSegment(claims)
      const signingInput = `${header}.${payload}`
      const signature = sign(null, Buffer.from(signingInput), signingKey).toString('base64url')
      return `${signingInput}.${signature}`
    },

    verifyIdentityAssertion(token, input) {
      const parts = token.split('.')
      if (parts.length !== 3)
        throw new AuthorizationError('identity_assertion_invalid')
      const [encodedHeader, encodedClaims, encodedSignature] = parts
      const header = parseSegment(encodedHeader)
      if (header.alg !== ALG || header.typ !== TYPE || typeof header.kid !== 'string')
        throw new AuthorizationError('identity_assertion_invalid')
      const verificationKey = keys.get(header.kid)
      if (!verificationKey)
        throw new AuthorizationError('identity_assertion_key_unknown')
      if (!verify(
        null,
        Buffer.from(`${encodedHeader}.${encodedClaims}`),
        verificationKey,
        Buffer.from(encodedSignature, 'base64url'),
      )) {
        throw new AuthorizationError('identity_assertion_signature_invalid')
      }

      const claims = parseSegment(encodedClaims)
      const nowSeconds = Math.floor(input.now / 1000)
      const skew = input.clockSkewSeconds ?? 30
      if (claims.iss !== options.issuer
        || claims.aud !== input.audience
        || claims.nonce !== input.nonce
        || typeof claims.sub !== 'string'
        || !claims.sub
        || typeof claims.app_id !== 'string'
        || !claims.app_id
        || !validScopes(claims.scope)
        || claims.phone_number_verified !== true
        || claims.account_status !== 'active'
        || typeof claims.iat !== 'number'
        || claims.iat - skew > nowSeconds
        || typeof claims.nbf !== 'number'
        || claims.nbf - skew > nowSeconds
        || typeof claims.exp !== 'number'
        || claims.exp + skew <= nowSeconds
        || claims.exp <= claims.iat
        || claims.exp - claims.iat > MAX_TTL_SECONDS
        || typeof claims.jti !== 'string'
        || !claims.jti) {
        throw new AuthorizationError('identity_assertion_claims_invalid')
      }
      return claims as unknown as IdentityAssertionClaims
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
