import type { UserProfile } from '~/types/social'

/**
 * SSR 代理：服务端取用户公开资料，用于 /u/[login] 的 SSR 与 SEO/OG。
 *
 * 经 CloudBase account-api 的 HTTP 访问服务（公开 action getProfile，无需登录态）。
 * 未配置 `accountApiHttpUrl` 时返回 null —— 页面会在客户端用 SDK 兜底拉取，不影响功能、仅无 SSR SEO。
 */
export default defineEventHandler(async (event): Promise<UserProfile | null> => {
  const { login, userId } = getQuery(event)
  const base = useRuntimeConfig().accountApiHttpUrl as string
  if (!base || (!login && !userId))
    return null
  try {
    const res = await $fetch<UserProfile | null>(base, {
      method: 'POST',
      body: { action: 'getProfile', login, userId },
    })
    return res ?? null
  }
  catch {
    // HTTP 访问不可用 / 用户不存在：交给客户端兜底
    return null
  }
})
