import type { AppRecord } from '~/types/app'

const LOGIN_PATTERN = /^[\w.-]{1,64}$/

export default defineEventHandler(async (event) => {
  const value = getQuery(event).login
  const login = (Array.isArray(value) ? value[0] : value)?.toString().trim() || ''
  if (!LOGIN_PATTERN.test(login))
    throw createError({ statusCode: 400, message: '用户标识无效' })

  let response: { ownerLogin: string, items: AppRecord[] }
  try {
    response = await fetchAppsPlatform<{ ownerLogin: string, items: AppRecord[] }>(
      event,
      `/api/markets/personal/${encodeURIComponent(login)}`,
    )
  }
  catch (error) {
    if (!isNotFound(error))
      throw error

    // CloudBase 用户名按小写规范化，但部分历史应用保留 GitHub 登录名大小写。
    // 只从公开市场投影寻找同名 owner，再用其原始大小写重试；不读取任何私有记录。
    const publicCatalog = await fetchAppsPlatform<{ items: AppRecord[] }>(
      event,
      '/api/apps/public',
    )
    const canonicalLogin = publicCatalog.items.find(app =>
      app.ownerLogin.toLocaleLowerCase('en-US') === login.toLocaleLowerCase('en-US'),
    )?.ownerLogin
    if (!canonicalLogin || canonicalLogin === login)
      throw error

    response = await fetchAppsPlatform<{ ownerLogin: string, items: AppRecord[] }>(
      event,
      `/api/markets/personal/${encodeURIComponent(canonicalLogin)}`,
    )
  }

  setResponseHeader(event, 'cache-control', 'public, max-age=60, stale-while-revalidate=300')
  return response
})

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object')
    return false
  const record = error as Record<string, unknown>
  return record.statusCode === 404 || record.status === 404
}
