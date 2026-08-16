import type { ServiceAuthVerifier, ServiceIdentity } from '../api/runtime-api.js'
import { createHash, timingSafeEqual } from 'node:crypto'

const MINIMUM_SERVICE_TOKEN_LENGTH = 32
const SERVICE_IDENTIFIER_PATTERN = /^[\w.:-]{3,128}$/

export interface StaticBearerServiceAuthVerifierOptions {
  token: string
  audience: string
  actor: string
}

function digest(value: string) {
  return createHash('sha256').update(value).digest()
}

function tokensMatch(left: string, right: string): boolean {
  return timingSafeEqual(digest(left), digest(right))
}

function invalidAuthentication(): Error {
  return new Error('Service authentication failed')
}

export class StaticBearerServiceAuthVerifier implements ServiceAuthVerifier {
  readonly #token: string
  readonly #audience: string
  readonly #identity: ServiceIdentity

  constructor(options: StaticBearerServiceAuthVerifierOptions) {
    if (options.token.length < MINIMUM_SERVICE_TOKEN_LENGTH || /\s/.test(options.token))
      throw new TypeError('A strong service credential is required')
    if (!SERVICE_IDENTIFIER_PATTERN.test(options.audience))
      throw new TypeError('Service audience is invalid')
    if (!SERVICE_IDENTIFIER_PATTERN.test(options.actor))
      throw new TypeError('Service actor is invalid')
    this.#token = options.token
    this.#audience = options.audience
    this.#identity = { actor: options.actor }
  }

  async verify(authorization: string, audience: string): Promise<ServiceIdentity> {
    const matched = /^Bearer (\S+)$/.exec(authorization)
    if (audience !== this.#audience || !matched?.[1] || !tokensMatch(matched[1], this.#token))
      throw invalidAuthentication()
    return { ...this.#identity }
  }
}
