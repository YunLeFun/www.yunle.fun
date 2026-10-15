import { readSsoClientId, readSsoCodeChallenge, readSsoCodeChallengeMethod, readSsoNonce, readSsoPrompt, readSsoRedirectUri, readSsoScope } from '@yunlefun/sso/protocol'
import { readNativeSsoCallbackUri } from './native-sso-callback'

/** Client-reported acquisition context. Identity and application attribution are server-owned. */
export interface AcquisitionTouch {
  capturedAt: number
  landingHost: string
  landingPath: string
  referrerHost: string
  utmSource: string
  utmMedium: string
  utmCampaign: string
}

export interface AcquisitionContext {
  version: 1
  firstTouch: AcquisitionTouch | null
  registerTouch: AcquisitionTouch | null
}

export type AcquisitionAuthMethod = 'phone_otp' | 'email_otp' | 'github' | 'wx_open' | 'unknown'

const MAX_AGE = 30 * 24 * 60 * 60 * 1000

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function text(value: unknown, limit: number): string {
  return typeof value === 'string' ? [...value].filter(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127).join('').trim().slice(0, limit) : ''
}

function campaign(value: unknown): string {
  const input = text(value, 120)
  return /^[\p{L}\p{N}\p{M} ._/-]*$/u.test(input) ? input : ''
}

function host(value: unknown): string {
  const input = text(value, 253)
  if (!input || /[\s/@?#:\\]/.test(input))
    return ''
  try {
    return new URL(`https://${input}`).hostname
  }
  catch {
    return ''
  }
}

function touch(value: unknown, now: number): AcquisitionTouch | null {
  const input = record(value)
  if (!input || typeof input.capturedAt !== 'number'
    || !Number.isFinite(input.capturedAt) || input.capturedAt <= 0
    || input.capturedAt > now + 60_000 || input.capturedAt < now - MAX_AGE) {
    return null
  }
  const path = text(input.landingPath, 256)
  return {
    capturedAt: input.capturedAt,
    landingHost: host(input.landingHost),
    landingPath: path.startsWith('/') && !path.startsWith('//') ? path.split(/[?#]/)[0]! : '',
    referrerHost: host(input.referrerHost),
    utmSource: campaign(input.utmSource),
    utmMedium: campaign(input.utmMedium),
    utmCampaign: campaign(input.utmCampaign),
  }
}

export function readAcquisitionContext(value: unknown, now = Date.now()): AcquisitionContext | null {
  const input = record(value)
  if (input?.version !== 1)
    return null
  const firstTouch = touch(input.firstTouch, now)
  const registerTouch = touch(input.registerTouch, now)
  return firstTouch || registerTouch ? { version: 1, firstTouch, registerTouch } : null
}

export function parseAcquisitionContext(value: string | null, now = Date.now()): AcquisitionContext | null {
  if (!value || new TextEncoder().encode(value).length > 4096)
    return null
  try {
    return readAcquisitionContext(JSON.parse(value) as unknown, now)
  }
  catch {
    return null
  }
}

function referrerHost(referrer: string, landingHost: string): string {
  try {
    const url = new URL(referrer)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
      return ''
    const hostname = url.hostname
    // Our own login/application hops do not describe the upstream acquisition channel.
    return hostname === landingHost || hostname === 'yunle.fun' || hostname.endsWith('.yunle.fun')
      || hostname === 'cook.yunyoujun.cn'
      ? ''
      : hostname
  }
  catch {
    return ''
  }
}

export function captureAcquisitionTouch(url: URL, referrer: string, now = Date.now()): AcquisitionTouch {
  return {
    capturedAt: now,
    landingHost: url.hostname,
    landingPath: url.pathname.slice(0, 256),
    referrerHost: referrerHost(referrer, url.hostname),
    utmSource: campaign(url.searchParams.get('utm_source')),
    utmMedium: campaign(url.searchParams.get('utm_medium')),
    utmCampaign: campaign(url.searchParams.get('utm_campaign')),
  }
}

/** Only an SSO route supplies an application hint; the server validates its Registry binding. */
export function readAcquisitionSsoRequest(url: URL): { clientId: string, redirectUri: string, nonce: string } | null {
  let entry = url
  if (['/login', '/signup'].includes(url.pathname)) {
    const redirect = url.searchParams.get('redirect') || ''
    if (!redirect.startsWith('/') || redirect.startsWith('//'))
      return null
    entry = new URL(redirect, url.origin)
  }
  if (entry.origin !== url.origin || entry.pathname !== '/auth/sso')
    return null
  const clientId = readSsoClientId(entry.searchParams.get('client_id'))
  const redirectUri = readSsoRedirectUri(entry.searchParams.get('redirect_uri'))
  const nonce = readSsoNonce(entry.searchParams.get('nonce'))
  const scope = readSsoScope(entry.searchParams.get('scope'))
  const codeChallenge = readSsoCodeChallenge(entry.searchParams.get('code_challenge'))
  const codeChallengeMethod = readSsoCodeChallengeMethod(entry.searchParams.get('code_challenge_method'))
  const rawPrompt = entry.searchParams.get('prompt') || ''
  const prompt = readSsoPrompt(rawPrompt)
  const nativeCallback = entry.searchParams.get('native_callback_uri') || ''
  if (!clientId || !redirectUri || !nonce || !scope.length || !codeChallenge || codeChallengeMethod !== 'S256'
    || (rawPrompt && !prompt)
    || (nativeCallback && (!readNativeSsoCallbackUri(nativeCallback) || prompt !== 'select_account'))) {
    return null
  }
  return { clientId, redirectUri, nonce }
}
