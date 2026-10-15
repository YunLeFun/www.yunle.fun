import type { AcquisitionAuthMethod, AcquisitionContext } from './acquisition'
import { readSsoClientId, readSsoNonce, readSsoRedirectUri } from '@yunlefun/sso/protocol'
import { captureAcquisitionTouch, parseAcquisitionContext, readAcquisitionContext, readAcquisitionSsoRequest } from './acquisition'
import { ACQUISITION_ATTEMPT_TTL_MS, readPendingAcquisition } from './acquisition-pending'

interface StorageAccess {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

export interface AcquisitionAttempt {
  attemptId?: string
  oauthState?: string
  context: AcquisitionContext | null
  sso: { clientId: string, redirectUri: string, nonce: string } | null
  authMethod: AcquisitionAuthMethod
  createdAt: number
}

const FIRST_KEY = 'ylf:acquisition:first:v1'
const ATTEMPT_KEY = 'ylf:acquisition:attempt:v1'
let memoryAttempt: AcquisitionAttempt | null = null

function read(storage: StorageAccess | undefined, key: string): unknown {
  try {
    return JSON.parse(storage?.getItem(key) || 'null') as unknown
  }
  catch {
    return null
  }
}

function write(storage: StorageAccess | undefined, key: string, value: unknown): void {
  try {
    storage?.setItem(key, JSON.stringify(value))
  }
  catch {
    // Storage may be denied; the current document can still finish attribution in memory.
    console.warn('[acquisition] Browser storage unavailable')
  }
}

export function readAcquisitionAttempt(storage?: StorageAccess, now = Date.now()): AcquisitionAttempt | null {
  const value = storage ? read(storage, ATTEMPT_KEY) : memoryAttempt
  if (!value || typeof value !== 'object' || !('createdAt' in value)
    || typeof value.createdAt !== 'number' || !Number.isFinite(value.createdAt) || value.createdAt <= 0 || value.createdAt > now + 60_000
    || now - value.createdAt > ACQUISITION_ATTEMPT_TTL_MS) {
    return null
  }
  const input = value as AcquisitionAttempt
  // The stored binding came from a complete request. Keep the v1 storage shape;
  // only the client/redirect/nonce binding is needed after the login redirect.
  const clientId = readSsoClientId(input.sso?.clientId)
  const redirectUri = readSsoRedirectUri(input.sso?.redirectUri)
  const nonce = readSsoNonce(input.sso?.nonce)
  const validSso = clientId && redirectUri && nonce ? { clientId, redirectUri, nonce } : null
  const method = ['phone_otp', 'email_otp', 'github', 'wx_open'].includes(input.authMethod)
    ? input.authMethod
    : 'unknown'
  return { ...(typeof input.attemptId === 'string' && /^[\w-]{16,128}$/.test(input.attemptId) ? { attemptId: input.attemptId } : {}), ...(validOAuthState(input.oauthState, method) ? { oauthState: input.oauthState } : {}), context: readAcquisitionContext(input.context, input.createdAt), sso: validSso, authMethod: method, createdAt: input.createdAt }
}

function validOAuthState(state: unknown, method: AcquisitionAuthMethod): state is string {
  return (method === 'github' || method === 'wx_open') && typeof state === 'string' && state.length <= 256
    && state.startsWith(`prd-${method}-`) && /^prd-(?:github|wx_open)-[a-z0-9.]+$/i.test(state)
}

function attemptId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** Capture document entry or an authentication navigation before an OAuth redirect. */
export function captureAcquisitionEntry(
  url: URL,
  referrer: string,
  stores: { local?: StorageAccess, session?: StorageAccess },
  now = Date.now(),
  entryKind: 'document' | 'navigation' = 'document',
): AcquisitionAttempt | null {
  const existing = readAcquisitionAttempt(stores.session, now)
  if (url.pathname.startsWith('/auth/callback'))
    return existing
  const sso = readAcquisitionSsoRequest(url)
  const sameSso = sso && existing?.sso?.clientId === sso.clientId && existing.sso.redirectUri === sso.redirectUri && existing.sso.nonce === sso.nonce
  if (sameSso && existing?.context)
    return existing
  // document.referrer belongs to the document entry, not the SPA route.
  const current = sso ? null : captureAcquisitionTouch(url, entryKind === 'navigation' ? '' : referrer, now)
  const hasNewUtm = !!(current?.utmSource || current?.utmMedium || current?.utmCampaign)
  const pending = readPendingAcquisition(now)
  if (existing && !sso && pending && pending.attemptId === existing.attemptId && pending.deadlineAt > now && !hasNewUtm && !current?.referrerHost)
    return existing
  const previous = existing?.context?.registerTouch
  const sameLanding = entryKind === 'navigation' && current && previous
    && current.landingHost === previous.landingHost && current.landingPath === previous.landingPath
    && current.utmSource === previous.utmSource && current.utmMedium === previous.utmMedium && current.utmCampaign === previous.utmCampaign
  if (!sso && existing && !existing.sso && (sameLanding || (['/login', '/signup'].includes(url.pathname) && !hasNewUtm)))
    return existing

  const ssoUrl = sso && ['/login', '/signup'].includes(url.pathname)
    ? new URL(url.searchParams.get('redirect')!, url.origin)
    : url
  const incoming = sso ? parseAcquisitionContext(ssoUrl.searchParams.get('acquisition'), now) : null
  let context: AcquisitionContext | null = incoming
  if (sso && !incoming) {
    let landing = captureAcquisitionTouch(ssoUrl, '', now)
    if (!landing.utmSource && !landing.utmMedium && !landing.utmCampaign && ssoUrl !== url)
      landing = captureAcquisitionTouch(url, '', now)
    if (landing.utmSource || landing.utmMedium || landing.utmCampaign)
      context = { version: 1, firstTouch: landing, registerTouch: landing }
  }
  if (current) {
    const first = readAcquisitionContext({ version: 1, firstTouch: read(stores.local, FIRST_KEY) }, now)?.firstTouch || current
    write(stores.local, FIRST_KEY, first)
    context = { version: 1, firstTouch: first, registerTouch: current }
  }
  // Without context or explicit UTM, an older SSO client's marketing channel stays unknown.
  if (sameSso && existing && !context)
    return existing
  const attempt: AcquisitionAttempt = sameSso && existing
    ? { ...existing, context }
    : { attemptId: attemptId(), context, sso, authMethod: 'unknown', createdAt: now }
  memoryAttempt = attempt
  write(stores.session, ATTEMPT_KEY, attempt)
  return attempt
}

function browserStorage(kind: 'localStorage' | 'sessionStorage'): StorageAccess | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window[kind]
  }
  catch {
    return undefined
  }
}

export function captureBrowserAcquisition(routePath?: string): AcquisitionAttempt | null {
  if (typeof window === 'undefined')
    return null
  return captureAcquisitionEntry(new URL(routePath || window.location.href, window.location.origin), routePath ? '' : document.referrer, {
    local: browserStorage('localStorage'),
    session: browserStorage('sessionStorage'),
  }, Date.now(), routePath ? 'navigation' : 'document')
}

export function currentAcquisitionAttempt(): AcquisitionAttempt | null {
  return readAcquisitionAttempt(browserStorage('sessionStorage')) || readAcquisitionAttempt()
}

export function setAcquisitionAuthMethod(authMethod: AcquisitionAuthMethod): AcquisitionAttempt | null {
  const attempt = currentAcquisitionAttempt() || captureBrowserAcquisition()
  if (!attempt)
    return null
  const updated = { ...attempt, attemptId: attempt.attemptId || attemptId(), authMethod, ...(attempt.authMethod !== authMethod ? { oauthState: undefined } : {}) }
  memoryAttempt = updated
  write(browserStorage('sessionStorage'), ATTEMPT_KEY, updated)
  return updated
}

/** Bind the SDK-generated state before redirecting. It is not a token or a callback URL. */
export function bindAcquisitionOAuthState(expected: AcquisitionAttempt, state: string): boolean {
  const current = currentAcquisitionAttempt()
  if (!current || current.attemptId !== expected.attemptId || current.createdAt !== expected.createdAt
    || current.authMethod !== expected.authMethod || JSON.stringify(current.context) !== JSON.stringify(expected.context)
    || !validOAuthState(state, expected.authMethod)) {
    return false
  }
  // A second OAuth login is a new attempt even if it uses the same provider.
  const updated = { ...current, attemptId: attemptId(), oauthState: state }
  memoryAttempt = updated
  write(browserStorage('sessionStorage'), ATTEMPT_KEY, updated)
  return true
}

export function oauthAcquisitionAttempt(state: string | null, authMethod: AcquisitionAuthMethod): AcquisitionAttempt | null {
  const current = currentAcquisitionAttempt()
  return current && validOAuthState(state, authMethod) && current.authMethod === authMethod && current.oauthState === state ? current : null
}

export function clearAcquisitionAttempt(expected?: AcquisitionAttempt): void {
  const current = currentAcquisitionAttempt()
  if (expected && (!current || current.attemptId !== expected.attemptId || current.createdAt !== expected.createdAt
    || current.authMethod !== expected.authMethod || JSON.stringify(current.context) !== JSON.stringify(expected.context) || current.sso)) {
    return
  }
  memoryAttempt = null
  try {
    browserStorage('sessionStorage')?.removeItem(ATTEMPT_KEY)
  }
  catch {
    console.warn('[acquisition] Could not clear browser acquisition attempt')
  }
}
