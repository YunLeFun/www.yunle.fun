import type { RegistryEnvironment, RegistryTrustAnchors } from './registry-types'

/**
 * Code-reviewed trust anchors for Registry snapshot verification.
 *
 * Database documents and function responses must never add keys at runtime.
 * Each environment keeps a separately reviewed signing key.
 */
export const registryTrustAnchors: RegistryTrustAnchors = Object.freeze({
  production: Object.freeze({
    'production-registry-20260809': Object.freeze({
      crv: 'Ed25519',
      kty: 'OKP',
      x: 'QjlKcyF4UNJHNitKnCw0IsBlt7VAZaqe0TnH2nSNZyA',
    }),
  }),
  development: Object.freeze({
    'development-registry-20260808': Object.freeze({
      crv: 'Ed25519',
      kty: 'OKP',
      x: 'izHjvgIwxNT7SAuiAwkBZcG2RBnqS6nhxv1DGbOh7NI',
    }),
  }),
})

export function hasRegistryTrustAnchor(environment: RegistryEnvironment): boolean {
  return Object.keys(registryTrustAnchors[environment]).length > 0
}
