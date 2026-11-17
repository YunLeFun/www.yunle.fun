import type { H3Event } from 'h3'
import { createError, setHeader } from 'h3'

export const COOK_HANDOFF_TOKEN = /^[\w-]{43}$/

export function cookHandoffCookie(request: string) {
  return `__Host-ylf-cook-${request}`
}

export function cookHandoffConfig(event: H3Event) {
  disableSessionResponseCaching(event)
  setHeader(event, 'referrer-policy', 'no-referrer')
  const config = useRuntimeConfig(event)
  if (!/^[a-f\d]{64}$/i.test(config.cookWebHandoffToken)
    || config.public.cloudbaseEnvId !== 'yunlefun-8g7ybcxc7345c490') {
    throw createError({ statusCode: 404, statusMessage: 'Account handoff unavailable' })
  }
  return config
}
