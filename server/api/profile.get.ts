import type { PublicProfileLookup } from '../utils/public-profile'
import type { UserProfile } from '~/types/social'
import { resolvePublicProfile } from '../utils/public-profile'

const UPSTREAM_TIMEOUT_MS = 5_000

function firstQueryString(value: unknown): string {
  const candidate = Array.isArray(value) ? value[0] : value
  return typeof candidate === 'string' ? candidate.trim() : ''
}

/**
 * SSR 代理：服务端取用户公开资料，用于 /u/[login] 的 SSR 与 SEO/OG。
 *
 * 经 CloudBase account-api 的 HTTP 访问服务（公开 action getProfile，无需登录态）。
 * 路由参数是公开 identifier：优先按合法 login 查询，否则/查不到时按 uid 查询。
 * 该接口是公开资料的唯一 Web 读取边界，不依赖浏览器 CloudBase 登录态。
 */
export default defineEventHandler(async (event): Promise<UserProfile> => {
  const query = getQuery(event)
  const identifier = firstQueryString(query.identifier)
  const login = firstQueryString(query.login)
  const userId = firstQueryString(query.userId)
  const lookup: PublicProfileLookup | null = identifier
    ? { identifier }
    : userId
      ? { userId }
      : login
        ? { login }
        : null

  if (!lookup) {
    throw createError({
      statusCode: 400,
      message: '缺少用户标识',
    })
  }

  const base = useRuntimeConfig().accountApiHttpUrl as string
  if (!base) {
    throw createError({
      statusCode: 503,
      message: '公开用户资料服务未配置',
    })
  }

  let profile: UserProfile | null
  try {
    profile = await resolvePublicProfile(lookup, profileQuery => $fetch<UserProfile | null>(base, {
      method: 'POST',
      body: { action: 'getProfile', ...profileQuery },
      timeout: UPSTREAM_TIMEOUT_MS,
      retry: 1,
    }))
  }
  catch (error) {
    console.error('[profile-api] account-api request failed', error)
    throw createError({
      statusCode: 502,
      message: '公开用户资料服务暂时不可用',
      cause: error,
    })
  }

  if (!profile) {
    throw createError({
      statusCode: 404,
      message: '用户不存在',
    })
  }

  return profile
})
