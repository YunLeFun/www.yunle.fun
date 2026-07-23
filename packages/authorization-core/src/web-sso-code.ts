import { Buffer } from 'node:buffer'
import { createHash, timingSafeEqual } from 'node:crypto'

import { AuthorizationError } from './index'

export interface WebSsoCodeRecord {
  status: 'pending' | 'consumed'
  codeHash: string
  subject: string
  issuer: string
  clientId: string
  appId: string
  scopes: readonly string[]
  origin: string
  redirectUri: string
  nonce: string
  codeChallenge: string
  codeChallengeMethod: 'S256'
  policyVersion: string
  registrationFingerprint: string
  issuedAt: number
  expiresAt: number
  consumedAt?: number
}

export interface IssueWebSsoCodeInput {
  subject: string
  issuer: string
  clientId: string
  appId: string
  scopes: readonly string[]
  origin: string
  redirectUri: string
  nonce: string
  codeChallenge: string
  policyVersion: string
  registrationFingerprint: string
  now: number
  ttlSeconds: number
}

export interface ConsumeWebSsoCodeInput {
  code: string
  issuer: string
  clientId: string
  appId: string
  scopes: readonly string[]
  origin: string
  redirectUri: string
  nonce: string
  codeVerifier: string
  policyVersion: string
  registrationFingerprint: string
  now: number
}

function sha256(value: string, encoding: 'base64url' | 'hex'): string {
  return createHash('sha256').update(value).digest(encoding)
}

function equal(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes)
}

function equalScopes(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length)
    return false
  const leftSorted = [...left].sort()
  const rightSorted = [...right].sort()
  return leftSorted.every((scope, index) => scope === rightSorted[index])
}

export function createWebSsoCodeMachine(options: { generateCode: () => string }) {
  return {
    issue(input: IssueWebSsoCodeInput) {
      const code = options.generateCode()
      const record: WebSsoCodeRecord = {
        status: 'pending',
        codeHash: sha256(code, 'hex'),
        subject: input.subject,
        issuer: input.issuer,
        clientId: input.clientId,
        appId: input.appId,
        scopes: [...input.scopes],
        origin: input.origin,
        redirectUri: input.redirectUri,
        nonce: input.nonce,
        codeChallenge: input.codeChallenge,
        codeChallengeMethod: 'S256',
        policyVersion: input.policyVersion,
        registrationFingerprint: input.registrationFingerprint,
        issuedAt: input.now,
        expiresAt: input.now + input.ttlSeconds * 1000,
      }
      return { code, record }
    },

    consume(record: WebSsoCodeRecord, input: ConsumeWebSsoCodeInput) {
      if (record.status !== 'pending')
        throw new AuthorizationError('code_used')
      if (record.expiresAt <= input.now)
        throw new AuthorizationError('code_expired')
      if (!equal(record.codeHash, sha256(input.code, 'hex'))
        || record.origin !== input.origin
        || record.redirectUri !== input.redirectUri
        || record.nonce !== input.nonce) {
        throw new AuthorizationError('code_binding_invalid')
      }
      if (record.issuer !== input.issuer
        || record.clientId !== input.clientId
        || record.appId !== input.appId
        || !equalScopes(record.scopes, input.scopes)
        || record.policyVersion !== input.policyVersion
        || record.registrationFingerprint !== input.registrationFingerprint) {
        throw new AuthorizationError('client_binding_invalid')
      }
      if (!equal(record.codeChallenge, sha256(input.codeVerifier, 'base64url')))
        throw new AuthorizationError('pkce_invalid')

      return {
        subject: record.subject,
        next: {
          ...record,
          status: 'consumed' as const,
          consumedAt: input.now,
        },
      }
    },
  }
}
