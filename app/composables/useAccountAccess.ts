export type AccountAccessState
  = | 'active'
    | 'deletion_pending'
    | 'deletion_finalizing'
    | 'admin_banned'
    | 'unavailable'

export interface AccountAccessStatus {
  state: AccountAccessState
  restricted: boolean
  recoverable?: boolean
  requestedAt?: number | null
  scheduledAt?: number | null
  reasonCode?: string
  publicReason?: string
  caseId?: string | null
  appealUrl?: string
  startedAt?: number | null
  expiresAt?: number | null
  permanent?: boolean
}

const ACTIVE_ACCESS: AccountAccessStatus = { state: 'active', restricted: false }
const UNAVAILABLE_ACCESS: AccountAccessStatus = { state: 'unavailable', restricted: true }
const ACCESS_CACHE_TTL_MS = 30_000
const RESTRICTED_STATES = new Set<AccountAccessState>([
  'deletion_pending',
  'deletion_finalizing',
  'admin_banned',
])

/** 兼容 CloudBase SDK envelope；任何畸形响应均失败关闭，避免绕过服务端限制。 */
export function normalizeAccountAccessResponse(response: unknown): AccountAccessStatus {
  if (!response || typeof response !== 'object')
    return { ...UNAVAILABLE_ACCESS }
  const outer = response as Record<string, unknown>
  const candidate = outer.result && typeof outer.result === 'object'
    ? outer.result as Record<string, unknown>
    : outer
  const state = candidate.state as AccountAccessState
  const restricted = candidate.restricted
  const valid = (state === 'active' && restricted === false)
    || (RESTRICTED_STATES.has(state) && restricted === true)
    || (state === 'unavailable' && restricted === true)
  return valid
    ? candidate as unknown as AccountAccessStatus
    : { ...UNAVAILABLE_ACCESS }
}

export function useAccountAccess() {
  const { app } = useCloudbase()
  const access = useState<AccountAccessStatus>('account_access', () => ({ ...ACTIVE_ACCESS }))
  const loading = useState<boolean>('account_access_loading', () => false)
  const loadedFor = useState<string | null>('account_access_loaded_for', () => null)
  const loadedAt = useState<number>('account_access_loaded_at', () => 0)

  async function refresh(userId?: string, force = false) {
    if (!app) {
      access.value = { ...UNAVAILABLE_ACCESS }
      return access.value
    }
    if (!force
      && userId
      && loadedFor.value === userId
      && Date.now() - loadedAt.value < ACCESS_CACHE_TTL_MS) {
      return access.value
    }

    loading.value = true
    try {
      const response = await app.callFunction({
        name: 'account-api',
        data: { action: 'getAccountAccessStatus' },
      })
      access.value = normalizeAccountAccessResponse(response)
      loadedFor.value = userId || loadedFor.value
      loadedAt.value = Date.now()
      return access.value
    }
    catch (error) {
      console.error('[account-access] 状态读取失败:', error)
      access.value = { ...UNAVAILABLE_ACCESS }
      return access.value
    }
    finally {
      loading.value = false
    }
  }

  async function recoverAccount() {
    if (!app)
      throw new Error('账号服务暂不可用')
    loading.value = true
    try {
      await app.callFunction({
        name: 'account-api',
        data: { action: 'cancelAccountDeletion' },
      })
      access.value = { ...ACTIVE_ACCESS }
      loadedAt.value = Date.now()
      return access.value
    }
    finally {
      loading.value = false
    }
  }

  function clear() {
    access.value = { ...ACTIVE_ACCESS }
    loadedFor.value = null
    loadedAt.value = 0
    loading.value = false
  }

  return {
    access: readonly(access),
    loading: readonly(loading),
    refresh,
    recoverAccount,
    clear,
  }
}
