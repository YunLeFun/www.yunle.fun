import { defineEventHandler, getRequestHost, getRequestURL, sendRedirect } from 'h3'

const APEX_HOST = 'yunle.fun'
const CANONICAL_ORIGIN = 'https://www.yunle.fun'

function normalizeHost(value: string): string {
  const host = value.split(',')[0]?.trim().toLowerCase()
  if (!host)
    return ''

  try {
    return new URL(`http://${host}`).hostname.replace(/\.$/, '')
  }
  catch {
    return ''
  }
}

export function getCanonicalRedirect(host: string, url: URL): string | null {
  if (normalizeHost(host) !== APEX_HOST)
    return null

  return `${CANONICAL_ORIGIN}${url.pathname}${url.search}`
}

export default defineEventHandler((event) => {
  const location = getCanonicalRedirect(
    getRequestHost(event, { xForwardedHost: true }),
    getRequestURL(event),
  )

  if (location)
    return sendRedirect(event, location, 301)
})
