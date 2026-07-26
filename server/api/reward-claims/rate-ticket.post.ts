import { getRequestIP } from 'h3'
import { createRewardClaimRateTicket } from '~~/cloudfunctions/account-api/reward-claim-security.js'

interface RateTicketBody {
  linkDigest?: string
}

export default defineEventHandler(async (event) => {
  assertSameOrigin(event)
  rateLimit(event, { key: 'reward-claim-rate-ticket', limit: 30, windowMs: 60_000 })
  disableSessionResponseCaching(event)

  const body = await readBody<RateTicketBody>(event)
  const linkDigest = typeof body?.linkDigest === 'string' ? body.linkDigest.trim() : ''
  if (!/^[a-f0-9]{64}$/.test(linkDigest))
    throw createError({ statusCode: 400, statusMessage: '领取链接摘要无效' })

  const ip = getRequestIP(event, { xForwardedFor: true })
  if (!ip)
    throw createError({ statusCode: 503, statusMessage: '暂时无法确认请求来源' })

  const config = useRuntimeConfig(event)
  const signer = createRewardClaimRateTicket({
    secret: config.rewardClaimRateTicketSecret,
  })
  return {
    rateTicket: signer.issue({ linkDigest, ip }),
    expiresInMs: 120_000,
  }
})
