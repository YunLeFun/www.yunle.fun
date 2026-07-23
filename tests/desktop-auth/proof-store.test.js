import { describe, expect, it } from 'vitest'

import { reserveProof } from '../../cloudfunctions/desktop-auth/lib/proof-store.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

describe('dPoP replay store', () => {
  it('accepts a jti once and rejects replay for the same device key', async () => {
    const db = makeFakeDb({})
    const proof = { jkt: 'device-thumbprint', jti: 'proof-0123456789abcdef' }

    await expect(reserveProof(db, proof, { now: 1_700_000_000_000 }))
      .resolves
      .toEqual({ ok: true })
    await expect(reserveProof(db, proof, { now: 1_700_000_000_001 }))
      .rejects
      .toMatchObject({ code: 'proof_replayed' })
  })
})
