/**
 * 双层会话 · 清 cookie（Phase 1，见 docs/cookie-session-migration.md）
 *
 * 清除持久会话 cookie。客户端另需 CloudBase SDK signOut（清内存 token）。
 */
export default defineEventHandler(async (event) => {
  // CSRF：登出也是状态变更，挡跨站强制登出（见 server/utils/session-security.ts）
  assertSameOrigin(event)
  await clearUserSession(event)
  return { ok: true }
})
