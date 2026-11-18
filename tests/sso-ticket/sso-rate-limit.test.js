import { describe, expect, it } from 'vitest'
import {
  createSsoRateLimiter,
  limitId,
  SSO_RATE_LIMIT_COLLECTION,
  SSO_RATE_LIMIT_COLLECTION_MANIFEST,
} from '../../cloudfunctions/sso-ticket/sso-rate-limit.js'

class FakeDatabase {
  documents = new Map()
  requests = []
  #queue = Promise.resolve()

  collection(name) {
    if (name !== SSO_RATE_LIMIT_COLLECTION)
      throw new Error(`unexpected collection ${name}`)
    return { doc: id => ({
      get: async () => {
        this.requests.push('get')
        return { data: this.documents.has(id) ? [{ ...this.documents.get(id), _id: id }] : [] }
      },
      create: async (value) => {
        this.requests.push('create')
        await this.#queue
        if (this.documents.has(id))
          throw new Error('E11000 duplicate key')
        this.documents.set(id, structuredClone(value))
        return { id }
      },
      set: async (value) => {
        this.documents.set(id, structuredClone(value))
        // CloudBase reports a successful first-time doc.set() as an upsert with
        // updated=0; only updates to an existing record require updated > 0.
        return { updated: 0, upsertedId: id }
      },
      update: async (value) => {
        this.documents.set(id, { ...this.documents.get(id), ...structuredClone(value) })
        return { updated: 1 }
      },
    }), where: ({ _id, ...match }) => ({
      update: async (value) => {
        this.requests.push('compare-and-update')
        await this.#queue
        const record = this.documents.get(_id)
        if (!record || !Object.entries(match).every(([key, field]) => record[key] === field))
          return { updated: 0 }
        this.documents.set(_id, { ...record, ...structuredClone(value) })
        return { updated: 1 }
      },
    }) }
  }

  async runTransaction(operation) {
    this.requests.push('transaction')
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
  it('claims a native WeChat code once across window boundaries', async () => {
    const database = new FakeDatabase()
    const digest = 'a'.repeat(64)
    const beforeMidnight = createSsoRateLimiter(database, { now: () => 86_399_999 })
    const afterMidnight = createSsoRateLimiter(database, { now: () => 86_400_001 })
    await beforeMidnight.claimCookWeChatCode(digest)
    await expect(afterMidnight.claimCookWeChatCode(digest)).rejects.toMatchObject({ reason: 'rate_limited' })
    expect(JSON.stringify([...database.documents])).not.toContain(digest)
  })
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

  const resolve = { scope: 'resolve-ip', key: 'edge-address', limit: 3, windowMs: 60_000 }

  it('spends two database calls for a new or existing resolve bucket and rejects a full one after one read', async () => {
    const database = new FakeDatabase()
    const limiter = createSsoRateLimiter(database, { now: () => 10_000 })
    await limiter.consume(resolve)
    await limiter.consume(resolve)
    await limiter.consume(resolve)
    await expect(limiter.consume(resolve)).rejects.toMatchObject({ reason: 'rate_limited' })
    expect(database.requests).toEqual(['get', 'create', 'get', 'compare-and-update', 'get', 'compare-and-update', 'get'])
    expect([...database.documents.values()]).toEqual([expect.objectContaining({ count: 3, windowStart: 0 })])
  })

  it.each([0, 1])('cannot overspend quota when simultaneous resolves race on a bucket starting at %d', async (initialCount) => {
    const database = new FakeDatabase()
    const limiter = createSsoRateLimiter(database, { now: () => 10_000 })
    if (initialCount)
      await limiter.consume(resolve)
    const outcomes = await Promise.allSettled(Array.from({ length: 4 }, () => limiter.consume(resolve)))
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(3 - initialCount)
    expect(outcomes.filter(outcome => outcome.status === 'rejected').map(outcome => outcome.reason)).toEqual(
      Array.from({ length: 1 + initialCount }, () => expect.objectContaining({ reason: 'rate_limited' })),
    )
    expect(database.requests).toContain('transaction')
    expect([...database.documents.values()]).toEqual([expect.objectContaining({ count: 3 })])
  })

  it('never replays a resolve write with an ambiguous outcome', async () => {
    const database = new FakeDatabase()
    const collection = database.collection.bind(database)
    database.collection = name => ({
      ...collection(name),
      where: () => ({ update: async () => { throw new Error('connection lost') } }),
    })
    const limiter = createSsoRateLimiter(database, { now: () => 10_000 })
    await limiter.consume(resolve)
    await expect(limiter.consume(resolve)).rejects.toThrow('connection lost')
    expect(database.requests).not.toContain('transaction')
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
