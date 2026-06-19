import type { NotificationListResult } from '~/types/social'

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

  /** 拉取未读数（进站 / 登录态变化时调用） */
  async function refreshUnread() {
    if (!user.value || !app) {
      unread.value = 0
      return
    }
    try {
      const res = await app.callFunction({ name: 'account-api', data: { action: 'getUnreadCount' } })
      unread.value = (res.result as { unread: number }).unread ?? 0
    }
    catch (err) {
      console.warn('[useNotifications] getUnreadCount failed:', err)
    }
  }

  /** 通知列表分页 */
  async function list(params: { skip?: number, limit?: number } = {}): Promise<NotificationListResult> {
    const empty: NotificationListResult = { items: [], nextSkip: null }
    if (!user.value || !app)
      return empty
    try {
      const res = await app.callFunction({
        name: 'account-api',
        data: { action: 'listNotifications', skip: params.skip ?? 0, limit: params.limit ?? 20 },
      })
      return (res.result as NotificationListResult) ?? empty
    }
    catch (err) {
      console.warn('[useNotifications] listNotifications failed:', err)
      return empty
    }
  }

  /** 标记已读（传 ids 标记指定，否则全部）；乐观更新未读数 */
  async function markRead(ids?: string[]) {
    if (!user.value || !app)
      return
    if (ids?.length)
      unread.value = Math.max(0, unread.value - ids.length)
    else
      unread.value = 0
    try {
      await app.callFunction({ name: 'account-api', data: { action: 'markNotificationsRead', ids } })
    }
    catch (err) {
      console.warn('[useNotifications] markRead failed:', err)
    }
  }

  return { unread, refreshUnread, list, markRead }
}
