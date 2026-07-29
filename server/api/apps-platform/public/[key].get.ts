import type { AppRecord } from '~/types/app'

const APP_KEY_PATTERN = /^[\w.-]{1,128}$/

export default defineEventHandler(async (event) => {
  const key = getRouterParam(event, 'key')?.trim() || ''
  if (!APP_KEY_PATTERN.test(key))
    throw createError({ statusCode: 400, message: '应用标识无效' })

  const response = await fetchAppsPlatform<{ app: AppRecord }>(
    event,
    `/api/apps/public/${encodeURIComponent(key)}`,
  )
  setResponseHeader(event, 'cache-control', 'public, max-age=60, stale-while-revalidate=300')
  return response
})
