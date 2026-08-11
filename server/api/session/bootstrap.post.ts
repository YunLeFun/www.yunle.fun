/**
 * 双层会话 · 取原始令牌恢复会话（Phase 1，见 docs/cookie-session-migration.md）
 *
 * 验 httpOnly cookie，取出封存的「原始 CloudBase 令牌」回传给客户端，由客户端 auth.setSession()
 * 恢复**原始会话**（openid 正确 → 直读数据库可用，避免 custom-ticket 会话的 DB 权限限制）。
 * 令牌存于 cookie 的 secure 段（仅服务端可读），随 HTTPS 响应下发，客户端落内存（memory-only）。
 */
export default defineEventHandler(async (event) => {
  disableSessionResponseCaching(event)

  // CSRF + 限速（见 server/utils/session-security.ts）
  assertSameOrigin(event)
  rateLimit(event, { key: 'session-bootstrap', limit: 60, windowMs: 60_000 })

  // bootstrap 本身负责判断是否有可恢复会话，因此游客态不能使用会主动抛 401 的 requireUserSession。
  const session = await getUserSession(event)
  const accessToken = session.secure?.accessToken
  const refreshToken = session.secure?.refreshToken
  // 游客没有可恢复的会话是正常启动状态，不应以 4xx 污染浏览器控制台。
  if (!accessToken || !refreshToken) {
    setResponseStatus(event, 204)
    return
  }
  return { accessToken, refreshToken }
})
