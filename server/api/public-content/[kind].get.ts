import { parseKind, validatePublished } from '~~/shared/public-content'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  let kind
  try {
    kind = parseKind(getRouterParam(event, 'kind'))
  }
  catch {
    throw createError({ statusCode: 404, message: '未知内容类型',
    })
  }
  const base = useRuntimeConfig(event).publicContentApiUrl.replace(/\/$/, '')
  if (!base)
    throw createError({ statusCode: 503, message: '公共内容服务尚未配置' })
  try {
    const result = validatePublished(await $fetch(`${base}/${kind}`, { timeout: 5000, retry: 0 }), kind)
    const etag = `"${result.releaseId}"`
    setResponseHeader(event, 'ETag', etag)
    setResponseHeader(event, 'Cache-Control', 'public, max-age=0, s-maxage=30, must-revalidate')
    if (getHeader(event, 'if-none-match') === etag) {
      setResponseStatus(event, 304)
      return null
    }
    return result
  }
  catch {
    throw createError({ statusCode: 503, message: '公共内容暂时不可用' })
  }
})
