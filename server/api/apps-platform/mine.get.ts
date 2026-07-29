import type { AppRecord } from '~/types/app'

export default defineEventHandler(async (event) => {
  disableSessionResponseCaching(event)
  const accessToken = await requireAppsPlatformAccessToken(event)
  return fetchAppsPlatform<{ items: AppRecord[] }>(event, '/api/apps/mine', accessToken)
})
