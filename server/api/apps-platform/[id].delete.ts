export default defineEventHandler(async (event) => {
  disableSessionResponseCaching(event)
  const accessToken = await requireAppsPlatformAccessToken(event)
  const id = getRouterParam(event, 'id') || ''
  if (!/^[\w.-]{1,128}$/.test(id))
    throw createError({ statusCode: 400, message: '应用标识无效' })
  return fetchAppsPlatform(event, `/api/apps/${encodeURIComponent(id)}`, accessToken, 'DELETE')
})
