import type { CookHandoffReply } from '../../../shared/utils/cook-web-handoff'
import { COOK_HANDOFF_TOKEN, cookHandoffConfig, cookHandoffCookie } from '../../utils/cook-web-handoff'

export default defineEventHandler(async (event): Promise<CookHandoffReply> => {
  const config = cookHandoffConfig(event)
  if (getHeader(event, 'origin') !== new URL(config.public.siteUrl).origin)
    throw createError({ statusCode: 403, statusMessage: 'Invalid account handoff origin' })
  rateLimit(event, { key: 'cook-handoff-redeem', limit: 100, windowMs: 60_000 })
  const input = await readBody<{ request?: unknown, confirmation?: unknown }>(event)
  const request = input?.request
  const confirmation = input?.confirmation ?? ''
  if (typeof request !== 'string' || !COOK_HANDOFF_TOKEN.test(request)
    || (confirmation !== '' && (typeof confirmation !== 'string' || !COOK_HANDOFF_TOKEN.test(confirmation)))) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid account handoff request' })
  }
  const cookie = cookHandoffCookie(request)
  const proof = getCookie(event, cookie)
  if (!proof || !COOK_HANDOFF_TOKEN.test(proof))
    throw createError({ statusCode: 410, statusMessage: 'Account handoff expired' })

  const cookieSubject = config.public.cookieSession
    ? (await getUserSession(event)).user?.uid ?? ''
    : ''
  const authorization = getHeader(event, 'authorization')
  // The relay is same-origin and private. The CloudBase function independently validates
  // any live SDK session before comparing it to the App account.
  const response = await $fetch.raw<CookHandoffReply>('https://api.yunle.fun/sso-ticket', {
    method: 'POST',
    headers: {
      'x-cook-handoff-key': config.cookWebHandoffToken,
      ...(authorization ? { authorization } : {}),
    },
    body: { action: 'redeemCookWebHandoff', request, proof, cookieSubject, confirmation },
    ignoreResponseError: true,
    redirect: 'error',
    retry: 0,
    timeout: 8000,
  }).catch(() => null)
  if (!response?.ok || !response._data) {
    const status = response?.status === 410 ? 410 : 503
    throw createError({ statusCode: status, statusMessage: 'Account handoff unavailable' })
  }
  const result = response._data
  if (result.state === 'pending')
    return { state: 'pending' }
  if (result.state === 'switch' && typeof result.confirmation === 'string' && COOK_HANDOFF_TOKEN.test(result.confirmation))
    return { state: 'switch', confirmation: result.confirmation }
  if ((result.state === 'issued' || result.state === 'reuse') && typeof result.subject === 'string' && result.subject) {
    if (result.state === 'issued' && (typeof result.ticket !== 'string' || !result.ticket || result.ticket.length > 32_768))
      throw createError({ statusCode: 503, statusMessage: 'Account handoff unavailable' })
    deleteCookie(event, cookie, { secure: true, httpOnly: true, sameSite: 'strict', path: '/' })
    return result.state === 'issued'
      ? { state: 'issued', subject: result.subject, ticket: result.ticket }
      : { state: 'reuse', subject: result.subject }
  }
  throw createError({ statusCode: 503, statusMessage: 'Account handoff unavailable' })
})
