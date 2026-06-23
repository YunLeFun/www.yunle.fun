/**
 * 双层会话 · 取原始令牌恢复会话（Phase 1，见 docs/cookie-session-migration.md）
 *
 * 验 httpOnly cookie，取出封存的「原始 CloudBase 令牌」回传给客户端，由客户端 auth.setSession()
 * 恢复**原始会话**（openid 正确 → 直读数据库可用，避免 custom-ticket 会话的 DB 权限限制）。
 * 令牌存于 cookie 的 secure 段（仅服务端可读），随 HTTPS 响应下发，客户端落内存（memory-only）。
 */
export default defineEventHandler(async (event) => {
  // CSRF + 限速（见 server/utils/session-security.ts）
  assertSameOrigin(event)
  rateLimit(event, { key: 'session-bootstrap', limit: 60, windowMs: 60_000 })

  const session = await requireUserSession(event)
  const accessToken = session.secure?.accessToken
  const refreshToken = session.secure?.refreshToken
  if (!accessToken || !refreshToken)
    throw createError({ statusCode: 401, statusMessage: 'no stored session tokens' })
  return { accessToken, refreshToken }
})
