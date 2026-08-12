import type { User } from '~/composables/auth/types'
import type { SsoAccountState } from '~/types/app-explorer'
import { computed, onMounted, shallowRef } from 'vue'

export function useSsoAccountState(redirectTo = '/') {
  // 云图只读取页头恢复后的共享状态，避免公开页为了展示账号节点同步拉取认证 SDK。
  const user = useState<User | null>('auth_user', () => null)
  const authReady = useState<boolean>('auth_ready', () => false)
  const hydrated = shallowRef(false)
  const loginTarget = `/login?redirect=${encodeURIComponent(redirectTo)}`

  const status = computed<SsoAccountState['status']>(() => {
    if (!hydrated.value)
      return 'pending'

    if (!authReady.value)
      return 'pending'

    return user.value ? 'authenticated' : 'guest'
  })

  const accountState = computed<SsoAccountState>(() => ({
    status: status.value,
    displayName: user.value?.nickname
      || user.value?.login
      || '云乐坊账号',
    avatar: user.value?.avatar,
    to: status.value === 'authenticated' ? '/profile' : loginTarget,
  }))

  onMounted(() => {
    hydrated.value = true
  })

  return accountState
}
