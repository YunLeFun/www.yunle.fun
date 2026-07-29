import type { H3Event } from 'h3'
import { createError, getHeader } from 'h3'

const UPSTREAM_TIMEOUT_MS = 5_000

function upstreamStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object')
    return
  const record = error as Record<string, unknown>
  if (typeof record.statusCode === 'number')
    return record.statusCode
  if (typeof record.status === 'number')
    return record.status
  const response = record.response
  if (response && typeof response === 'object') {
    const status = (response as Record<string, unknown>).status
    return typeof status === 'number' ? status : undefined
  }
}

function upstreamMessage(error: unknown): string | undefined {
  if (!error || typeof error !== 'object')
    return
  const record = error as Record<string, unknown>
  const data = record.data
  if (data && typeof data === 'object') {
    const message = (data as Record<string, unknown>).message
    if (typeof message === 'string')
      return message
  }
  return typeof record.message === 'string' ? record.message : undefined
}

function appsPlatformUrl(event: H3Event, path: string): string {
  const base = String(useRuntimeConfig(event).appsPlatformApiUrl || '').replace(/\/+$/, '')
  if (!base)
    throw createError({ statusCode: 503, message: '云乐坊应用服务未配置' })
  return `${base}${path}`
}

export async function fetchAppsPlatform<T>(
  event: H3Event,
  path: string,
  accessToken?: string,
): Promise<T> {
  try {
    return await $fetch<T>(appsPlatformUrl(event, path), {
      headers: accessToken
        ? { Authorization: `Bearer ${accessToken}` }
        : undefined,
      timeout: UPSTREAM_TIMEOUT_MS,
      retry: 1,
    }) as T
  }
  catch (error) {
    const statusCode = upstreamStatus(error)
    if (statusCode === 400 || statusCode === 401 || statusCode === 403 || statusCode === 404) {
      throw createError({
        statusCode,
        message: upstreamMessage(error) || '云乐坊应用请求失败',
        cause: error,
      })
    }

    console.error('[apps-platform] upstream request failed', { path, statusCode })
    throw createError({
      statusCode: 502,
      message: '云乐坊应用服务暂时不可用',
      cause: error,
    })
  }
}

export async function requireAppsPlatformAccessToken(event: H3Event): Promise<string> {
  const authorization = getHeader(event, 'authorization')?.trim() || ''
  const bearer = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : ''
  if (bearer)
    return bearer

  const session = await getUserSession(event)
  const accessToken = session.secure?.accessToken?.trim()
  if (accessToken)
    return accessToken

  throw createError({ statusCode: 401, message: '请先登录' })
}
