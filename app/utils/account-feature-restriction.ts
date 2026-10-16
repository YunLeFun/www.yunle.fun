/**
 * Identify only an explicit account-service rejection, never a generic SDK failure.
 * @param value Account-service response payload.
 * @returns Whether the server explicitly restricted this test-account feature.
 */
export function isTestAccountFeatureRestriction(value: unknown): boolean {
  if (!value || typeof value !== 'object')
    return false
  const response = value as Record<string, unknown>
  return response.ok === false && response.code === 'synthetic_action_forbidden'
}
