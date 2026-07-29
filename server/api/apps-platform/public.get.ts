import type { AppRecord } from '~/types/app'

export default defineEventHandler(async (event) => {
  const response = await fetchAppsPlatform<{ items: AppRecord[] }>(event, '/api/apps/public')
  setResponseHeader(event, 'cache-control', 'public, max-age=60, stale-while-revalidate=300')
  return response
})
