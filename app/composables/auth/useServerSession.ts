/**
 * 双层会话客户端编排（见 docs/cookie-session-migration.md）。
 *
 * 串起「自有 httpOnly cookie 会话」与「CloudBase SDK 会话」两层：
 * - setServerSession：CloudBase 登录成功后，把原始 access/refresh token 封进 httpOnly cookie
 * - bootstrapFromCookie：启动时凭 cookie 取回原始 token，并用 auth.setSession 恢复同一 CloudBase 会话
 * - clearServerSession：登出清 cookie
 *
 * 全部容错：服务端会话端点不可用（如 SSR 运行时未托管）时不抛错，调用方回退到既有登录态。
 */
export function useServerSession() {
  const { auth } = useCloudbase()

  /** 登录成功后封原始令牌到 cookie。非阻塞：失败不影响既有登录态。 */
  async function setServerSession(): Promise<boolean> {
    if (import.meta.server)
      return false
    try {
      const { data } = await auth.getSession()
      const accessToken = data?.session?.access_token
      const refreshToken = data?.session?.refresh_token
      if (!accessToken || !refreshToken)
        return false
      await $fetch('/api/session/login', { method: 'POST', body: { accessToken, refreshToken } })
      return true
    }
    catch (e) {
      console.warn('[session] setServerSession 失败（回退既有登录态）:', e)
      return false
    }
  }

  /**
   * 启动：凭 httpOnly cookie 取出原始令牌，setSession 恢复**原始会话**。
   * 相比 custom-ticket，恢复的是原始会话（openid 正确 → 直读数据库可用）。
   * 无 cookie（bootstrap 返回 401）时静默返回 false。
   */
  async function bootstrapFromCookie(): Promise<boolean> {
    if (import.meta.server)
      return false
    try {
      const res = await $fetch<{ accessToken?: string, refreshToken?: string }>(
        '/api/session/bootstrap',
        { method: 'POST' },
      )
      if (!res?.accessToken || !res?.refreshToken)
        return false
      // setSession 内部用 refresh_token 刷新并恢复会话
      const { data, error } = await auth.setSession({
        access_token: res.accessToken,
        refresh_token: res.refreshToken,
      })
      if (error || !data?.session)
        return false
      // 刷新可能轮换 refresh_token：用刷新后的新令牌重新封 cookie，避免下次用到失效令牌
      await setServerSession()
      return true
    }
    catch {
      return false
    }
  }

  /** 登出清 cookie（CloudBase signOut 由调用方另行处理）。 */
  async function clearServerSession(): Promise<void> {
    if (import.meta.server)
      return
    try {
      await $fetch('/api/session/logout', { method: 'POST' })
    }
    catch {}
  }

  return { setServerSession, bootstrapFromCookie, clearServerSession }
}
