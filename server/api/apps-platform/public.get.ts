import type { AppRecord } from '~/types/app'

export default defineEventHandler(async (event) => {
  const response = await fetchAppsPlatform<{ items: AppRecord[] }>(event, '/api/apps/public')
  setResponseHeader(event, 'cache-control', 'no-store')
  return response
})
