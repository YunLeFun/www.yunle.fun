import { describe, expect, it } from 'vitest'

import {
  quotaDocumentId,
  runQuotaChat,
  shanghaiDateKey,
} from '../../cloudfunctions/ai-gateway/lib/quota.js'

const MESSAGES = [{ role: 'user', content: '调查记录' }]

function reservation(overrides = {}) {
  return {
    allowed: true,
    documentId: 'quota-doc',
    limit: 9,
    remaining: 8,
    used: 1,
    ...overrides,
  }
}

describe('ai-gateway daily quota', () => {
  it('uses Asia/Shanghai calendar days and opaque document ids', () => {
    expect(shanghaiDateKey(Date.UTC(2026, 6, 12, 16, 30))).toBe('2026-07-13')
    expect(quotaDocumentId({ uid: 'user-1', appId: 'zero-echo-2026', dateKey: '2026-07-13' }))
      .toMatch(/^[a-f0-9]{64}$/)
  })

  it('returns remaining quota after a successful generation', async () => {
    const released = []
    const result = await runQuotaChat({ uid: 'user-1', limit: 9, messages: MESSAGES }, {
      reserve: async () => reservation(),
      generate: async () => '{"dialogue":"ok"}',
      release: async value => released.push(value),
    })

    expect(result).toMatchObject({
      ok: true,
      quota: { limit: 9, remaining: 8, used: 1 },
    })
    expect(released).toHaveLength(0)
  })

  it('blocks exhausted users before generation', async () => {
    let generated = false
    const result = await runQuotaChat({ uid: 'user-1', limit: 9, messages: MESSAGES }, {
      reserve: async () => reservation({ allowed: false, remaining: 0, used: 9 }),
      generate: async () => {
        generated = true
        return 'should-not-run'
      },
      release: async () => {},
    })

    expect(result).toMatchObject({ ok: false, code: 'quota_exhausted' })
    expect(generated).toBe(false)
  })

  it('releases a reservation when generation fails', async () => {
    const released = []
    const result = await runQuotaChat({ uid: 'user-1', limit: 27, messages: MESSAGES }, {
      reserve: async () => reservation({ limit: 27, remaining: 26 }),
      generate: async () => { throw new Error('provider down') },
      release: async value => released.push(value),
    })

    expect(result).toMatchObject({ ok: false, code: 'ai_failed' })
    expect(released).toEqual([expect.objectContaining({ documentId: 'quota-doc' })])
  })
})
