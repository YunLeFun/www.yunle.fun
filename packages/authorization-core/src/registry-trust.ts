import type { RegistryEnvironment, RegistryTrustAnchors } from './registry-types'

/**
 * Code-reviewed trust anchors for Registry snapshot verification.
 *
 * Database documents and function responses must never add keys at runtime.
 * Production remains empty until its separately confirmed rollout.
 */
export const registryTrustAnchors: RegistryTrustAnchors = Object.freeze({
  production: Object.freeze({}),
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
