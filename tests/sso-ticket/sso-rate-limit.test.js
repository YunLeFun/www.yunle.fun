import { describe, expect, it } from 'vitest'
import {
  createSsoRateLimiter,
  limitId,
  SSO_RATE_LIMIT_COLLECTION,
  SSO_RATE_LIMIT_COLLECTION_MANIFEST,
} from '../../cloudfunctions/sso-ticket/sso-rate-limit.js'

class FakeDatabase {
  documents = new Map()
  #queue = Promise.resolve()

  collection(name) {
    if (name !== SSO_RATE_LIMIT_COLLECTION)
      throw new Error(`unexpected collection ${name}`)
    return { doc: id => ({
      get: async () => ({ data: this.documents.has(id) ? [{ ...this.documents.get(id), _id: id }] : [] }),
      set: async (value) => {
        this.documents.set(id, structuredClone(value))
        return { updated: 1 }
      },
      update: async (value) => {
        this.documents.set(id, { ...this.documents.get(id), ...structuredClone(value) })
        return { updated: 1 }
      },
    }) }
  }

  async runTransaction(operation) {
    const previous = this.#queue
    let release = () => undefined
    this.#queue = new Promise(resolve => release = resolve)
    await previous
    try {
      return await operation(this)
    }
    finally {
      release()
    }
  }
}

describe('sso durable rate limits', () => {
  it('enforces a concurrent fixed-window limit without persisting the raw key', async () => {
    const database = new FakeDatabase()
    const limiter = createSsoRateLimiter(database, { now: () => 10_000 })
    const attempts = await Promise.allSettled(Array.from({ length: 4 }, () => limiter.consume({
      scope: 'exchange-ip',
      key: 'sensitive-client-address',
      limit: 3,
      windowMs: 60_000,
    })))
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(3)
    expect(attempts.find(result => result.status === 'rejected')?.reason).toMatchObject({ reason: 'rate_limited' })
    expect(JSON.stringify([...database.documents.values()])).not.toContain('sensitive-client-address')
    expect(database.documents.has(limitId('exchange-ip', 'sensitive-client-address', 0))).toBe(true)
  })

  it('exports a server-only cleanup manifest', () => {
    expect(SSO_RATE_LIMIT_COLLECTION_MANIFEST).toMatchObject({
      collection: 'sso_security_limits',
      access: 'server-only',
      browserRead: false,
      browserWrite: false,
      retention: { terminalHours: 24 },
    })
  })
})
