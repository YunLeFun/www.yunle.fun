/** Persistent replay protection for proof-of-possession JWTs. */

'use strict'

const { createHash } = require('node:crypto')
const { AuthorizationError } = require('@yunlefun/authorization-core')

const PROOF_REPLAY_COLLECTION = 'desktop_proof_replays'
const DEFAULT_PROOF_TTL_MS = 10 * 60 * 1000

function proofId({ jkt, jti }) {
  return createHash('sha256').update(`${jkt}\u0000${jti}`).digest('hex')
}

async function reserveProof(db, proof, options = {}) {
  const now = options.now ?? Date.now()
  try {
    await db.collection(PROOF_REPLAY_COLLECTION).add({
      _id: proofId(proof),
      jkt: proof.jkt,
      createdAt: now,
      expiresAt: now + (options.ttlMs ?? DEFAULT_PROOF_TTL_MS),
    })
  }
  catch (error) {
    if (/duplicate|already exists|exist/i.test(String(error?.message || error)))
      throw new AuthorizationError('proof_replayed')
    throw error
  }
  return { ok: true }
}

module.exports = {
  DEFAULT_PROOF_TTL_MS,
  PROOF_REPLAY_COLLECTION,
  reserveProof,
}
