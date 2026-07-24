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

export function isPublicAuthRoute(path: string) {
  return PUBLIC_AUTH_ROUTE_EXACT.includes(path)
    || PUBLIC_AUTH_ROUTE_PREFIXES.some(route => path === route || path.startsWith(`${route}/`))
}
