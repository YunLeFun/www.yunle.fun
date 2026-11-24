import type { MembershipRecord, MembershipState } from '~/types/membership'
import { useIntervalFn, useTimestamp } from '@vueuse/core'

/**
 * 由会员记录派生出前端可直接消费的会员状态。
 */
function deriveState(record: MembershipRecord | null, now: number): MembershipState | null {
  if (!record)
    return null
  const expireAt = Math.max(record.expireAt, record.accessExpireAt ?? 0)
  const remainingMs = Math.max(0, expireAt - now)
  return {
    ...record,
    paidExpireAt: record.expireAt,
    expireAt,
    active: remainingMs > 0,
    remainingMs,
  }
}

/**
 * 会员状态 composable
 *
 * - SSR 安全：模块层不直接访问 cloudbase
 * - 全局共享：通过 useState 在多个组件间复用同一份状态
 * - 与 useTcbAuth 联动：用户登出时自动清空
 */
export function useMembership() {
  const { app } = useCloudbase()
  const { user } = useTcbAuth()

  const record = useState<MembershipRecord | null>('membership_record', () => null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const now = useTimestamp({ scheduler: update => useIntervalFn(update, 60_000) })

  const state = computed(() => deriveState(record.value, now.value))
  const isActive = computed(() => !!state.value?.active)

  async function refresh(options: { throwOnError?: boolean } = {}): Promise<MembershipRecord | null> {
    if (!user.value) {
      record.value = null
      return null
    }
    if (!app) {
      return record.value
    }
    loading.value = true
    error.value = null
    const requestedUserId = user.value.id
    try {
      const response = await app.callFunction({
        name: 'account-api',
        data: { action: 'getMembership' },
      })
      if (user.value?.id !== requestedUserId)
        return null
      const value = response.result
      record.value = value && typeof value === 'object' ? value as MembershipRecord : null
      return record.value
    }
    catch (err) {
      if (user.value?.id !== requestedUserId)
        return null
      error.value = err instanceof Error ? err.message : '获取会员状态失败'
      console.warn('[useMembership] refresh failed:', err)
      if (options.throwOnError)
        throw err
      return record.value
    }
    finally {
      if (user.value?.id === requestedUserId)
        loading.value = false
    }
  }

  function clear() {
    record.value = null
    error.value = null
    loading.value = false
  }

  // 用户变化时自动刷新
  watch(
    () => user.value?.id,
    (newId, oldId) => {
      if (newId !== oldId) {
        clear()
        if (newId)
          refresh()
      }
    },
    { immediate: false },
  )

  return {
    record: readonly(record),
    state,
    isActive,
    loading: readonly(loading),
    error: readonly(error),
    refresh,
    clear,
  }
}
