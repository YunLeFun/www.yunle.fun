const NATIVE_CALLBACK_STATE_RE = /^[\w-]{43}$/

/**
 * Accept only the mobile callback owned by the Yunle app. The random state is
 * generated and verified by the native adapter; this page only preserves it.
 */
export function readNativeSsoCallbackUri(input: unknown): string | null {
  if (typeof input !== 'string' || !input)
    return null
  try {
    const url = new URL(input)
    const entries = [...url.searchParams.entries()]
    if (url.protocol !== 'yunlefun:'
      || url.hostname !== 'auth'
      || url.pathname !== '/sso'
      || url.port
      || url.username
      || url.password
      || url.hash
      || entries.length !== 1
      || entries[0]?.[0] !== 'state'
      || !NATIVE_CALLBACK_STATE_RE.test(entries[0]?.[1] ?? '')) {
      return null
    }
    return url.toString()
  }
  catch {
    return null
  }
}

/** Wrap the ordinary HTTPS redirect result without changing its OAuth binding. */
export function buildNativeSsoCallbackUrl(
  callbackUri: string,
  resultUrl: string,
): string {
  const callback = readNativeSsoCallbackUri(callbackUri)
  if (!callback)
    throw new TypeError('invalid native SSO callback')
  const result = new URL(resultUrl)
  if (result.protocol !== 'https:'
    || result.username
    || result.password
    || !result.hostname
    || !result.hash.startsWith('#ylf_sso=')
    || result.hash.includes('&')) {
    throw new TypeError('invalid native SSO result')
  }
  const url = new URL(callback)
  url.searchParams.set('result', result.toString())
  return url.toString()
}
