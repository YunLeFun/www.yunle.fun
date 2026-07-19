import { describe, expect, it } from 'vitest'

import {
  codeChallenge,
  codeId,
  createSsoCodeStore,
  SSO_LOGIN_CODE_COLLECTION,
  SSO_LOGIN_CODE_COLLECTION_MANIFEST,
  SsoCodeStoreError,
} from '../../cloudfunctions/sso-ticket/sso-code-store.js'

class FakeDatabase {
  documents = new Map()
  #queue = Promise.resolve()

  collection(name) {
    if (name !== SSO_LOGIN_CODE_COLLECTION)
      throw new Error(`unexpected collection ${name}`)
    return {
      doc: id => ({
        get: async () => ({ data: this.documents.has(id) ? [{ _id: id, ...structuredClone(this.documents.get(id)) }] : [] }),
        set: async (value) => {
          this.documents.set(id, structuredClone(value))
          return { updated: 1 }
        },
        update: async (value) => {
          const current = this.documents.get(id)
          if (!current)
            return { updated: 0 }
          this.documents.set(id, { ...current, ...structuredClone(value) })
          return { updated: 1 }
        },
      }),
    }
  }

  async runTransaction(operation) {
    const previous = this.#queue
    let release = () => undefined
    this.#queue = new Promise((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await operation(this)
    }
    finally {
      release()
    }
  }
}

function fixture() {
  let now = 1_000
  const code = 'c'.repeat(43)
  const database = new FakeDatabase()
  const store = createSsoCodeStore(database, {
    now: () => now,
    randomCode: () => code,
    ttlMs: 10_000,
  })
  return { code, database, store, advance: milliseconds => now += milliseconds }
}

const VERIFIER = 'v'.repeat(64)
const CHALLENGE = codeChallenge(VERIFIER)

describe('sso one-time authorization-code store', () => {
  it('persists only a SHA-256 identifier and safe binding metadata', async () => {
    const { code, database, store } = fixture()
    await store.issue({
      uid: 'user_1234',
      targetOrigin: 'https://drive.yunle.fun',
      nonce: 'n'.repeat(32),
      codeChallenge: CHALLENGE,
      mode: 'redirect',
    })
    expect(database.documents.has(codeId(code))).toBe(true)
    expect(database.documents.has(code)).toBe(false)
    expect(JSON.stringify([...database.documents.values()])).not.toContain(code)
  })

  it('allows exactly one concurrent consume for the bound origin and nonce', async () => {
    const { code, store } = fixture()
    await store.issue({
      uid: 'user_1234',
      targetOrigin: 'https://drive.yunle.fun',
      nonce: 'n'.repeat(32),
      codeChallenge: CHALLENGE,
      mode: 'redirect',
    })
    const attempts = await Promise.allSettled([
      store.consume({ code, requestOrigin: 'https://drive.yunle.fun', nonce: 'n'.repeat(32), codeVerifier: VERIFIER }),
      store.consume({ code, requestOrigin: 'https://drive.yunle.fun', nonce: 'n'.repeat(32), codeVerifier: VERIFIER }),
    ])
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = attempts.find(result => result.status === 'rejected')
    expect(rejected?.reason).toBeInstanceOf(SsoCodeStoreError)
    expect(rejected?.reason.reason).toBe('code_used')
  })

  it('rejects mismatched bindings and expiry without exposing the subject', async () => {
    const { code, store, advance } = fixture()
    await store.issue({
      uid: 'user_1234',
      targetOrigin: 'https://drive.yunle.fun',
      nonce: 'n'.repeat(32),
      codeChallenge: CHALLENGE,
      mode: 'redirect',
    })
    await expect(store.consume({ code, requestOrigin: 'https://cms.example.com', nonce: 'n'.repeat(32), codeVerifier: VERIFIER })).rejects.toMatchObject({ reason: 'code_binding_invalid' })
    await expect(store.consume({ code, requestOrigin: 'https://drive.yunle.fun', nonce: 'n'.repeat(32), codeVerifier: 'x'.repeat(64) })).rejects.toMatchObject({ reason: 'pkce_invalid' })
    advance(10_000)
    await expect(store.consume({ code, requestOrigin: 'https://drive.yunle.fun', nonce: 'n'.repeat(32), codeVerifier: VERIFIER })).rejects.toMatchObject({ reason: 'code_expired' })
  })

  it('fails closed when the SDK reports a zero-document consume update', async () => {
    const { code, database, store } = fixture()
    await store.issue({
      uid: 'user_1234',
      targetOrigin: 'https://drive.yunle.fun',
      nonce: 'n'.repeat(32),
      codeChallenge: CHALLENGE,
      mode: 'redirect',
    })
    const originalCollection = database.collection.bind(database)
    database.collection = name => ({
      doc: id => ({
        ...originalCollection(name).doc(id),
        update: async () => ({ updated: 0 }),
      }),
    })
    await expect(store.consume({
      code,
      requestOrigin: 'https://drive.yunle.fun',
      nonce: 'n'.repeat(32),
      codeVerifier: VERIFIER,
    })).rejects.toMatchObject({ reason: 'code_conflict' })
  })

  it('exports a server-only expiry index manifest', () => {
    expect(SSO_LOGIN_CODE_COLLECTION_MANIFEST).toEqual({
      collection: 'sso_login_codes',
      access: 'server-only',
      browserRead: false,
      browserWrite: false,
      indexes: [{
        name: 'status_expires',
        fields: [{ field: 'status', order: 'asc' }, { field: 'expiresAt', order: 'asc' }],
        unique: false,
      }, {
        name: 'expires_at',
        fields: [{ field: 'expiresAt', order: 'asc' }],
        unique: false,
      }],
      retention: { terminalHours: 24 },
    })
  })
})
