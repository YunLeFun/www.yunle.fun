import { createHash, randomBytes } from 'node:crypto'
import { COOK_HANDOFF_TOKEN, cookHandoffConfig, cookHandoffCookie } from '../../utils/cook-web-handoff'

export default defineEventHandler((event) => {
  cookHandoffConfig(event)
  const { request } = getQuery(event)
  if (request === undefined)
    return { supported: true }
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
  // Safari exposes only the origin and path of its initial redirect to the App.
  // Both path segments are hashes; the two actual proofs remain separate.
  return sendRedirect(event, `/api/session/cook-handoff/${request}/${binding}`, 303)
})
