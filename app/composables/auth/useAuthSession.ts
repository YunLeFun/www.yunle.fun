import { useTcbAuthCore } from './useAuthCore'

export function useTcbAuthSession() {
  const core = useTcbAuthCore()

  return {
    user: readonly(core.user),
    loading: readonly(core.loading),
    error: readonly(core.error),
    isAuthenticated: core.isAuthenticated,
    checkAuthStatus: core.checkAuthStatus,
    logout: core.logout,
  }
}
