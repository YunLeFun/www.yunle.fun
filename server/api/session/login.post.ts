/**
 * 双层会话 · 种 cookie（Phase 1，见 docs/cookie-session-migration.md）
 *
 * 客户端 CloudBase 登录成功后，把 access_token 交给服务端：服务端向 CloudBase
 * /auth/v1/user/me 校验该 token 真实性并取 uid（杜绝前端伪造 uid），再封 sealed httpOnly cookie。
 * cookie 是「我们自己的持久会话」，与 CloudBase SDK 的内存 token 解耦。
 */
export default defineEventHandler(async (event) => {
  // CSRF + 限速（见 server/utils/session-security.ts）
  assertSameOrigin(event)
  rateLimit(event, { key: 'session-login', limit: 20, windowMs: 60_000 })

  const body = await readBody<{ accessToken?: string, refreshToken?: string }>(event)
  const accessToken = body?.accessToken?.trim()
  const refreshToken = body?.refreshToken?.trim()
  if (!accessToken || !refreshToken)
    throw createError({ statusCode: 400, statusMessage: 'missing tokens' })

  const envId = useRuntimeConfig(event).public.cloudbaseEnvId
  // 服务端校验 access_token 取 uid（杜绝伪造）—— 复用 CloudBase 网关 /auth/v1/user/me
  const profile = await $fetch<Record<string, unknown>>(
    `https://${envId}.api.tcloudbasegateway.com/auth/v1/user/me`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  ).catch(() => null)

  const uid = (profile?.sub || profile?.uid || profile?.id) as string | undefined
  if (!uid)
    throw createError({ statusCode: 401, statusMessage: 'invalid CloudBase session' })

  await setUserSession(event, {
    user: {
      uid,
      name: (profile?.name || profile?.nickname) as string | undefined,
    },
    loggedInAt: Date.now(),
    // secure：仅服务端可读，封原始令牌供启动时 setSession 恢复原始会话
    secure: { accessToken, refreshToken },
  })
  return { ok: true }
})
