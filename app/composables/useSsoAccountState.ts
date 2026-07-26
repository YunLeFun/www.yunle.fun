import type { SsoAccountState } from '~/types/app-explorer'
import { computed, onMounted, shallowRef } from 'vue'
import { useTcbAuthSession } from '~/composables/auth/useAuthSession'

export function useSsoAccountState(redirectTo = '/') {
  const authSession = useTcbAuthSession()
  const hydrated = shallowRef(false)
  const loginTarget = `/login?redirect=${encodeURIComponent(redirectTo)}`

  const status = computed<SsoAccountState['status']>(() => {
    if (!hydrated.value)
      return 'pending'

    return authSession.authStatus?.value
      ?? (authSession.user?.value ? 'authenticated' : 'guest')
  })

  const accountState = computed<SsoAccountState>(() => ({
    status: status.value,
    displayName: authSession.user?.value?.nickname
      || authSession.user?.value?.login
      || '云乐坊账号',
    avatar: authSession.user?.value?.avatar,
    to: status.value === 'authenticated' ? '/profile' : loginTarget,
  }))

  onMounted(() => {
    hydrated.value = true
  })

  return accountState
}
