import { describe, expect, it } from 'vitest'

import {
  rateLimitDocumentId,
  reserveIpRateLimit,
  runIpRateLimit,
} from '../../cloudfunctions/ai-gateway/lib/ip-rate-limit.js'

function createFakeDatabase() {
  let document = null
  const command = {
    gt: value => ({ op: 'gt', value }),
    gte: value => ({ op: 'gte', value }),
    inc: value => ({ op: 'inc', value }),
    lt: value => ({ op: 'lt', value }),
    lte: value => ({ op: 'lte', value }),
  }

  function matches(query) {
    return document && Object.entries(query).every(([field, expected]) => {
      const actual = document[field]
      if (!expected || typeof expected !== 'object')
        return actual === expected
      if (expected.op === 'gt')
        return actual > expected.value
      if (expected.op === 'gte')
        return actual >= expected.value
      if (expected.op === 'lt')
        return actual < expected.value
      if (expected.op === 'lte')
        return actual <= expected.value
      return false
    })
  }

  const collection = {
    async add(value) {
      if (document)
        throw Object.assign(new Error('duplicate'), { code: 'DATABASE_DUPLICATE_KEY' })
      document = { ...value }
    },
    doc() {
      return { get: async () => ({ data: document ? [{ ...document }] : [] }) }
    },
    where(query) {
      return {
        async update(changes) {
          if (!matches(query))
            return { updated: 0 }
          document = Object.fromEntries(Object.entries({ ...document, ...changes }).map(([field, value]) => [
            field,
            value && typeof value === 'object' && value.op === 'inc'
              ? document[field] + value.value
              : value,
          ]))
          return { updated: 1 }
        },
      }
    },
  }

  return {
    collection: () => collection,
    command,
  }
}

const input = {
  appId: 'zero-echo-2026',
  blockMs: 60_000,
  clientKey: 'a'.repeat(64),
  limit: 6,
  windowMs: 60_000,
}

describe('ai-gateway IP rate limit', () => {
  it('uses an opaque per-app document id', () => {
    expect(rateLimitDocumentId(input)).toMatch(/^[a-f0-9]{64}$/)
    expect(rateLimitDocumentId(input)).not.toContain(input.clientKey)
  })

  it('allows six requests, blocks the seventh for 60 seconds, then resets', async () => {
    const db = createFakeDatabase()
    const now = 1_700_000_000_000

    for (let index = 0; index < 6; index += 1) {
      await expect(reserveIpRateLimit(db, { ...input, now })).resolves.toMatchObject({
        allowed: true,
        remaining: 5 - index,
      })
    }
    await expect(reserveIpRateLimit(db, { ...input, now })).resolves.toMatchObject({
      allowed: false,
      retryAfterSeconds: 60,
    })
    await expect(reserveIpRateLimit(db, { ...input, now: now + 30_000 })).resolves.toMatchObject({
      allowed: false,
      retryAfterSeconds: 30,
    })
    await expect(reserveIpRateLimit(db, { ...input, now: now + 60_000 })).resolves.toMatchObject({
      allowed: true,
      remaining: 5,
    })
  })

  it('returns a provider-neutral decision shape', async () => {
    await expect(runIpRateLimit(input, {
      reserve: async () => ({ allowed: false, limit: 6, retryAfterSeconds: 60 }),
    })).resolves.toEqual({
      allowed: false,
      code: 'rate_limited',
      limit: 6,
      ok: true,
      remaining: 0,
      retryAfterSeconds: 60,
    })
  })
})
