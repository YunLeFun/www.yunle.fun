import type { RegistryEnvironment, RegistryTrustAnchors } from './registry-types'

/**
 * Code-reviewed trust anchors for Registry snapshot verification.
 *
 * P1 keeps both maps empty until the separately approved key-ceremony task.
 * Database documents and function responses must never add keys at runtime.
 */
export const registryTrustAnchors: RegistryTrustAnchors = Object.freeze({
  production: Object.freeze({}),
  development: Object.freeze({}),
})

export function hasRegistryTrustAnchor(environment: RegistryEnvironment): boolean {
  return Object.keys(registryTrustAnchors[environment]).length > 0
}
