import type { AuthVerifier, RuntimeIdentity } from './types.js'

const ENV_ID_PATTERN = /^[a-z0-9][a-z0-9-]{4,63}$/
const MAX_ACCESS_TOKEN_LENGTH = 8_192

export class RuntimeAuthError extends Error {
  readonly code = 'AUTH_REQUIRED'

  constructor() {
    super('Authentication is required')
  }
}

export interface CloudBaseAuthHttpVerifierOptions {
  envId: string
  fetch?: typeof globalThis.fetch
  timeoutMs?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function profileUid(profile: Record<string, unknown>): string | undefined {
  for (const field of ['sub', 'uid', 'id']) {
    const value = profile[field]
    if (typeof value === 'string' && value)
      return value
  }
  return undefined
}

function isAnonymousProfile(profile: Record<string, unknown>): boolean {
  if (profile.is_anonymous === true || profile.isAnonymous === true || profile.role === 'anonymous')
    return true
  const metadata = profile.user_metadata
  return isRecord(metadata) && (metadata.is_anonymous === true || metadata.isAnonymous === true)
}

export class CloudBaseAuthHttpVerifier implements AuthVerifier {
  readonly #endpoint: string
  readonly #fetch: typeof globalThis.fetch
  readonly #timeoutMs: number

  constructor(options: CloudBaseAuthHttpVerifierOptions) {
    if (!ENV_ID_PATTERN.test(options.envId))
      throw new TypeError('CloudBase environment id is invalid')
    this.#endpoint = `https://${options.envId}.api.tcloudbasegateway.com/auth/v1/user/me`
    this.#fetch = options.fetch ?? globalThis.fetch
    this.#timeoutMs = options.timeoutMs ?? 5_000
  }

  async verifyAccessToken(accessToken: string): Promise<RuntimeIdentity> {
    const token = accessToken.trim()
    if (!token || token.length > MAX_ACCESS_TOKEN_LENGTH)
      throw new RuntimeAuthError()

    let response: Response
    try {
      response = await this.#fetch(this.#endpoint, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(this.#timeoutMs),
      })
    }
    catch {
      throw new RuntimeAuthError()
    }
    if (!response.ok)
      throw new RuntimeAuthError()

    const profile: unknown = await response.json().catch(() => null)
    if (!isRecord(profile) || isAnonymousProfile(profile))
      throw new RuntimeAuthError()
    const uid = profileUid(profile)
    if (!uid)
      throw new RuntimeAuthError()
    return { uid }
  }
}
