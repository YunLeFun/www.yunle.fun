import { createHash, randomBytes } from 'node:crypto'
import { COOK_HANDOFF_TOKEN, cookHandoffConfig, cookHandoffCookie } from '../../utils/cook-web-handoff'

const cookCallback = 'https://cook.yunyoujun.cn/auth/callback?platform=native'

export default defineEventHandler((event) => {
  cookHandoffConfig(event)
  const { request, transport } = getQuery(event)
  if (transport !== undefined && transport !== 'browser')
    throw createError({ statusCode: 400, statusMessage: 'Invalid account handoff transport' })
  if (request === undefined)
    return { supported: true, systemBrowser: true }
  if (typeof request !== 'string' || !COOK_HANDOFF_TOKEN.test(request))
    throw createError({ statusCode: 400, statusMessage: 'Invalid account handoff request' })
  rateLimit(event, { key: 'cook-handoff-start', limit: 30, windowMs: 60_000 })
  const proof = randomBytes(32).toString('base64url')
  setCookie(event, cookHandoffCookie(request), proof, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 120,
  })
  const binding = createHash('sha256').update(proof).digest('base64url')
  // iOS apps on Mac open the system browser without a Safari view delegate.
  // Deliver only the hashes to Cook's registered system authentication callback.
  if (transport === 'browser')
    return sendRedirect(event, `${cookCallback}#cook_handoff=${request}.${binding}`, 303)

  // Safari exposes only the origin and path of its initial redirect to the App.
  // Both path segments are hashes; the two actual proofs remain separate.
  return sendRedirect(event, `/api/session/cook-handoff/${request}/${binding}`, 303)
})
