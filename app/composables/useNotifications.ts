import type { NotificationListResult } from '~/types/social'
import { isTestAccountFeatureRestriction } from '~/utils/account-feature-restriction'

/**
 * 站内通知 composable（MVP：关注通知）。
 *
 * - 对接 account-api 的 getUnreadCount / listNotifications / markNotificationsRead
 * - unread 用 useState 全局共享（铃铛红点与弹窗共用一份）
 */
export function useNotifications() {
  const { app } = useCloudbase()
  const { user } = useTcbAuth()

  const unread = useState<number>('notif_unread', () => 0)
  const userId = computed(() => user.value?.id ?? null)
  const restrictedFor = useState<string | null>('notif_restricted_uid', () => null)
  const stateUserId = useState<string | null>('notif_state_uid', () => null)
  const restricted = computed(() => !!userId.value && restrictedFor.value === userId.value)

  watch(userId, (uid) => {
    if (stateUserId.value === uid)
      return
    stateUserId.value = uid
    unread.value = 0
    restrictedFor.value = null
  }, { immediate: true, flush: 'sync' })

  function acceptRestriction(value: unknown, uid: string) {
    if (!isTestAccountFeatureRestriction(value))
      return false
    restrictedFor.value = uid
    unread.value = 0
    return true
  }

  /** 拉取未读数（进站 / 登录态变化时调用） */
  async function refreshUnread() {
    const uid = userId.value
    if (!uid || !app || restricted.value) {
      return
    }
    try {
      const res = await app.callFunction({ name: 'account-api', data: { action: 'getUnreadCount', restrictionResponse: 'v1' } })
      if (userId.value !== uid || acceptRestriction(res.result, uid))
        return
      const result = res.result as { unread: number }
      if (!Number.isSafeInteger(result?.unread) || result.unread < 0)
        throw new Error('通知未读数响应无效')
      unread.value = result.unread
    }
    catch (err) {
      console.warn('[useNotifications] getUnreadCount failed:', err)
    }
  }

  /** 通知列表分页 */
  async function list(params: { skip?: number, limit?: number } = {}): Promise<NotificationListResult> {
    const empty: NotificationListResult = { items: [], nextSkip: null }
    const uid = userId.value
    if (!uid || !app || restricted.value)
      return empty
    try {
      const res = await app.callFunction({
        name: 'account-api',
        data: { action: 'listNotifications', skip: params.skip ?? 0, limit: params.limit ?? 20, restrictionResponse: 'v1' },
      })
      if (userId.value !== uid || acceptRestriction(res.result, uid))
        return empty
      const result = res.result as NotificationListResult
      if (!Array.isArray(result?.items) || (result.nextSkip !== null && (!Number.isSafeInteger(result.nextSkip) || result.nextSkip < 0)))
        throw new Error('通知列表响应无效')
      return result
    }
    catch (err) {
      console.warn('[useNotifications] listNotifications failed:', err)
      throw err
    }
  }

  /** 标记已读（传 ids 标记指定，否则全部）；仅在服务端确认后更新未读数。 */
  async function markRead(ids?: string[]): Promise<boolean> {
    const uid = userId.value
    if (!uid || !app || restricted.value)
      return false
    try {
      const res = await app.callFunction({ name: 'account-api', data: { action: 'markNotificationsRead', ids, restrictionResponse: 'v1' } })
      if (userId.value !== uid || acceptRestriction(res.result, uid))
        return false
      if ((res.result as { ok?: boolean })?.ok !== true)
        throw new Error('通知已读响应无效')
      unread.value = ids?.length ? Math.max(0, unread.value - ids.length) : 0
      return true
    }
    catch (err) {
      console.warn('[useNotifications] markRead failed:', err)
      throw err
    }
  }

  return { userId, unread, restricted, refreshUnread, list, markRead }
}
