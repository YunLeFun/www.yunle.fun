import type { H3Event } from 'h3'
import { getMethod, getRequestHeader, getRequestIP, readRawBody, setResponseHeaders, setResponseStatus } from 'h3'

const DEVELOPMENT_ENV_ID = 'yunlefun-dev-0ge03bdod37093d1'
const DEVELOPMENT_PROVIDER_ORIGIN = 'https://www.yunle.localhost:3000'
const RESPONSE_HEADERS = new Set([
  'access-control-allow-headers',
  'access-control-allow-methods',
  'access-control-allow-origin',
  'access-control-max-age',
  'cache-control',
  'content-type',
  'pragma',
  'referrer-policy',
  'vary',
])

interface FunctionHttpResponse {
  statusCode: number
  headers?: Record<string, string>
  body?: string
}

function isFunctionHttpResponse(value: unknown): value is FunctionHttpResponse {
  return !!value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Number.isInteger((value as FunctionHttpResponse).statusCode)
}

function assertDevelopmentProxy(config: ReturnType<typeof useRuntimeConfig>): void {
  if (config.public.siteUrl !== DEVELOPMENT_PROVIDER_ORIGIN
    || config.public.cloudbaseEnvId !== DEVELOPMENT_ENV_ID
    || !config.public.cloudbaseAccessKey) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }
}

async function invokeDevelopmentTicket(event: H3Event, method: string): Promise<FunctionHttpResponse> {
  const config = useRuntimeConfig(event)
  assertDevelopmentProxy(config)
  const { default: cloudbase } = await import('@cloudbase/js-sdk')
  const app = cloudbase.init({
    env: DEVELOPMENT_ENV_ID,
    region: String(config.public.cloudbaseRegion),
    accessKey: String(config.public.cloudbaseAccessKey),
  })
  const body = method === 'POST' ? await readRawBody(event, 'utf8') : ''
  const invocation = await app.callFunction({
    name: 'sso-ticket',
    data: {
      httpMethod: method,
      headers: {
        'content-type': getRequestHeader(event, 'content-type') ?? '',
        'origin': getRequestHeader(event, 'origin') ?? '',
        'x-forwarded-proto': 'https',
      },
      body,
      requestContext: {
        http: {
          sourceIp: getRequestIP(event, { xForwardedFor: true }) ?? 'unknown',
        },
      },
    },
  }) as unknown
  const envelope = invocation as { code?: unknown, message?: unknown, result?: unknown }
  const result = envelope.result && typeof envelope.result === 'object'
    ? envelope.result
    : invocation
  if (envelope.code || !isFunctionHttpResponse(result))
    throw createError({ statusCode: 502, statusMessage: 'Development SSO exchange is unavailable' })
  return result
}

export default defineEventHandler(async (event) => {
  const method = getMethod(event)
  if (method !== 'OPTIONS' && method !== 'POST')
    throw createError({ statusCode: 405, statusMessage: 'Method Not Allowed' })
  const response = await invokeDevelopmentTicket(event, method)
  const headers = Object.fromEntries(
    Object.entries(response.headers ?? {})
      .filter(([name]) => RESPONSE_HEADERS.has(name.toLowerCase())),
  )
  setResponseHeaders(event, headers)
  setResponseStatus(event, response.statusCode)
  return response.body ?? ''
})
