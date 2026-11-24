import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createCookWebHandoffStore, handleCookWebHandoff } from '../../cloudfunctions/sso-ticket/cook-web-handoff.js'

const digest = input => createHash('sha256').update(input).digest('base64url')
const verifier = 'v'.repeat(43)
const proof = 'p'.repeat(43)
const serviceToken = '1'.repeat(64)
const origin = 'https://cook.yunyoujun.cn'

function fixture() {
  let now = 1000
  const records = new Map()
  let queue = Promise.resolve()
  const database = {
    runTransaction(run) {
      const next = queue.then(() => run(database))
      queue = next.then(() => undefined, () => undefined)
      return next
    },
    collection: () => ({ doc: id => ({
      get: async () => ({ data: records.get(id) ?? null }),
      set: async (value) => {
        records.set(id, value)
        return { updated: 1 }
      },
      update: async (value) => {
        records.set(id, { ...records.get(id), ...value })
        return { updated: 1 }
      },
    }) }),
  }
  const deps = {
    store: createCookWebHandoffStore(database, () => now),
    serviceToken,
    signingReady: () => true,
    authorizeClient: () => ({ appId: 'cook', clientId: 'cook-mobile' }),
    currentAccount: vi.fn(async authorization => ({ sub: authorization.split(' ')[1], status: 'ACTIVE' })),
    requireAdmission: vi.fn(async () => {}),
    rateLimit: vi.fn(async () => {}),
    mintTicket: vi.fn(uid => ({ ok: true, ticket: `web-ticket-for-${uid}` })),
  }
  const approve = (overrides, subject = 'cook-user') => handleCookWebHandoff({
    action: 'approveCookWebHandoff',
    clientId: 'cook-mobile',
    verifier,
    binding: digest(proof),
    ...overrides,
  }, { authorization: `Bearer ${subject}`, deviceId: 'fixture-device', origin, ip: 'test-ip' }, deps)
  const redeem = (browserSubject = '', fields = {}, token = serviceToken) => handleCookWebHandoff({
    action: 'redeemCookWebHandoff',
    request: digest(verifier),
    proof,
    cookieSubject: '',
    confirmation: '',
    ...fields,
  }, { serviceToken: token, authorization: browserSubject ? `Bearer ${browserSubject}` : '' }, deps)
  return { approve, redeem, records, deps, advance: amount => now += amount }
}

describe('cook app to account website handoff', () => {
  it('opens a new browser session for the App account, only once across concurrent requests', async () => {
    const { approve, redeem, deps, records } = fixture()
    expect((await redeem()).body).toEqual({ state: 'pending' })
    expect((await approve()).body).toEqual({ ok: true })
    const results = await Promise.all([redeem(), redeem()])
    expect(results.map(result => result.status).sort()).toEqual([200, 410])
    expect(results.find(result => result.status === 200)?.body)
      .toEqual({ state: 'issued', subject: 'cook-user', ticket: 'web-ticket-for-cook-user' })
    expect(deps.mintTicket).toHaveBeenCalledExactlyOnceWith('cook-user')
    expect(JSON.stringify([...records])).not.toContain(proof)
    expect(JSON.stringify([...records])).not.toContain(verifier)
  })

  it('keeps the same live browser session without minting a login ticket', async () => {
    const { approve, redeem, deps } = fixture()
    await approve()
    expect((await redeem('cook-user', { cookieSubject: 'cook-user' })).body)
      .toEqual({ state: 'reuse', subject: 'cook-user' })
    expect(deps.mintTicket).not.toHaveBeenCalled()
  })

  it('retries approval for the same account until redemption without extending its validity', async () => {
    const { approve, redeem, records, deps, advance } = fixture()
    const first = await approve()
    const original = [...records.values()][0]
    advance(40_000)
    expect(await approve()).toEqual(first)
    expect([...records.values()]).toEqual([original])
    expect((await approve(undefined, 'other-user')).status).toBe(409)
    expect((await redeem()).body).toMatchObject({ state: 'issued', subject: 'cook-user' })
    expect((await approve()).status).toBe(409)
    expect((await redeem()).status).toBe(410)
    expect(deps.mintTicket).toHaveBeenCalledExactlyOnceWith('cook-user')
  })

  it('requires confirmation for a different browser or cookie account, and binds consent to that snapshot', async () => {
    const { approve, redeem, deps } = fixture()
    await approve()
    const browser = await redeem('other-user')
    const cookie = await redeem('', { cookieSubject: 'cookie-user', confirmation: browser.body.confirmation })
    expect(browser.body.state).toBe('switch')
    expect(cookie.body.state).toBe('switch')
    expect(cookie.body.confirmation).not.toBe(browser.body.confirmation)
    expect(deps.mintTicket).not.toHaveBeenCalled()
    const result = await redeem('', { cookieSubject: 'cookie-user', confirmation: cookie.body.confirmation })
    expect(result.body).toMatchObject({ state: 'issued', subject: 'cook-user' })
  })

  it('rejects a selected UID, an untrusted relay, a different browser proof and an expired request', async () => {
    const { approve, redeem, advance, deps } = fixture()
    expect((await approve({ uid: 'other-user' })).status).toBe(400)
    await approve()
    expect((await redeem('', {}, 'wrong-key')).status).toBe(403)
    expect((await redeem('', { proof: 'x'.repeat(43) })).body).toEqual({ state: 'pending' })
    advance(120_000)
    expect((await approve()).status).toBe(409)
    expect((await redeem()).status).toBe(410)
    expect(deps.mintTicket).not.toHaveBeenCalled()
  })
})
