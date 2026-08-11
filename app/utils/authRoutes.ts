const PUBLIC_AUTH_ROUTE_EXACT = [
  '/',
  '/login',
  '/signup',
  '/auth/sso',
  '/auth/github',
  '/auth/callback',
  '/pricing',
  '/explore',
  '/download',
]

const PUBLIC_AUTH_ROUTE_PREFIXES = [
  '/claim',
  '/docs',
  '/blog',
  '/changelog',
  '/apps',
  '/developer',
  '/u',
]

const POST_LOGIN_REDIRECT_BLOCKLIST = [
  '/login',
  '/signup',
  '/auth/github',
  '/auth/callback',
]

function normalizeRoutePath(path: string) {
  if (path === '/')
    return path
  return path.replace(/\/+$/, '')
}

export function isPublicAuthRoute(path: string) {
  const normalizedPath = normalizeRoutePath(path)
  return PUBLIC_AUTH_ROUTE_EXACT.includes(normalizedPath)
    || PUBLIC_AUTH_ROUTE_PREFIXES.some(route => normalizedPath === route || normalizedPath.startsWith(`${route}/`))
}

export function getSafeLoginRedirect(value: unknown) {
  if (typeof value !== 'string' || !value.startsWith('/'))
    return '/'

  try {
    const baseUrl = new URL('https://www.yunle.fun')
    const targetUrl = new URL(value, baseUrl)
    if (targetUrl.origin !== baseUrl.origin)
      return '/'

    const targetPath = normalizeRoutePath(targetUrl.pathname)
    if (POST_LOGIN_REDIRECT_BLOCKLIST.includes(targetPath))
      return '/'

    return `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`
  }
  catch {
    return '/'
  }
}
