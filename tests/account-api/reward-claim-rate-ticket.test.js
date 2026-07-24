import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'

import {
  createRewardClaimRateTicket,
  createRewardClaimTokenPort,
  publicLinkDigest,
  RewardClaimSecurityError,
} from '../../cloudfunctions/account-api/reward-claim-security.js'

const NOW = 1_800_000_000_000
const HASH_KEY = 'link-hash-key-that-is-at-least-32-bytes'
const TICKET_KEY = 'rate-ticket-key-that-is-at-least-32-bytes'

describe('权益领取链接与速率凭证', () => {
  it('生成 256-bit base64url 令牌且持久化摘要不包含明文', () => {
    const tokenPort = createRewardClaimTokenPort({
      hashKey: HASH_KEY,
      siteUrl: 'https://www.yunle.fun/',
      randomBytes: size => Buffer.alloc(size, 7),
    })

    const raw = tokenPort.generate()
    const digest = tokenPort.digest(raw)

    expect(raw).toMatch(/^[\w-]{43}$/)
    expect(digest).toMatch(/^[a-f0-9]{64}$/)
    expect(digest).not.toContain(raw)
    expect(tokenPort.publicUrl(raw)).toBe(`https://www.yunle.fun/claim#${raw}`)
  })

  it('拒绝缺失、过短或复用的安全密钥', () => {
    expect(() => createRewardClaimTokenPort({ hashKey: 'short' }))
      .toThrow(RewardClaimSecurityError)
    expect(() => createRewardClaimRateTicket({ secret: 'short' }))
      .toThrow(RewardClaimSecurityError)
    expect(() => createRewardClaimRateTicket({
      secret: TICKET_KEY,
      linkHashKey: TICKET_KEY,
    })).toThrow(/必须相互独立/)
  })

  it('签发不含原始 IP 的两分钟凭证并校验链接绑定', () => {
    const rateTicket = createRewardClaimRateTicket({
      secret: TICKET_KEY,
      now: () => NOW,
      randomBytes: size => Buffer.alloc(size, 9),
    })
    const linkDigest = publicLinkDigest('raw-link-token-that-is-long-enough-for-testing')
    const ticket = rateTicket.issue({
      linkDigest,
      ip: '203.0.113.8',
    })
    const payloadText = Buffer.from(ticket.split('.')[1], 'base64url').toString('utf8')

    expect(payloadText).not.toContain('203.0.113.8')
    expect(rateTicket.verify(ticket, { tokenDigest: linkDigest })).toMatchObject({
      ipHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      linkDigest,
      issuedAt: NOW,
      expiresAt: NOW + 120_000,
    })
    expect(() => rateTicket.verify(ticket, {
      tokenDigest: publicLinkDigest('another-token-that-is-long-enough-for-testing'),
    })).toThrow(/链接不匹配/)
  })

  it('拒绝篡改、过期和未来签发的速率凭证', () => {
    let current = NOW
    const rateTicket = createRewardClaimRateTicket({
      secret: TICKET_KEY,
      now: () => current,
      randomBytes: crypto.randomBytes,
    })
    const linkDigest = publicLinkDigest('raw-link-token-that-is-long-enough-for-testing')
    const ticket = rateTicket.issue({ linkDigest, ip: '2001:db8::1' })
    const parts = ticket.split('.')

    expect(() => rateTicket.verify(`${parts[0]}.${parts[1]}.bad`, { tokenDigest: linkDigest }))
      .toThrow(/签名无效/)

    current = NOW + 120_001
    expect(() => rateTicket.verify(ticket, { tokenDigest: linkDigest }))
      .toThrow(/已过期/)

    current = NOW - 31_000
    expect(() => rateTicket.verify(ticket, { tokenDigest: linkDigest }))
      .toThrow(/签发时间无效/)
  })
})
