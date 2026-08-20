import { describe, expect, it } from 'vitest'

import { createTestLeaseStore } from '../../cloudfunctions/sso-ticket/test-lease-store.js'

const NOW = Date.UTC(2026, 6, 17)

describe('sso-ticket CloudBase issuance store', () => {
  it('atomically claims only a reserved, fully-bound issuance', async () => {
    const db = new MemoryDb(validDocuments())
    const store = createTestLeaseStore(db, { pollAttempts: 1, pollDelayMs: 0 })

    await expect(store.claim({ leaseId: 'lease_01', issuanceId: 'issuance_01', now: NOW }))
      .resolves
      .toMatchObject({ kind: 'claimed', uid: 'test_uid_01', expiresAt: NOW + 600_000 })
    expect(db.get('test_ticket_issuances', 'issuance_01').status).toBe('minting')
  })

  it('returns an already escrowed issuance without claiming or reminting', async () => {
    const documents = validDocuments()
    Object.assign(documents.test_ticket_issuances.issuance_01, escrowFields(), { status: 'minted' })
    const db = new MemoryDb(documents)
    const store = createTestLeaseStore(db)

    await expect(store.claim({ leaseId: 'lease_01', issuanceId: 'issuance_01', now: NOW }))
      .resolves
      .toEqual({ kind: 'minted' })
    expect(db.get('test_ticket_issuances', 'issuance_01').status).toBe('minted')
  })

  it('fails closed on a broken identity pointer and leaves the reservation untouched', async () => {
    const documents = validDocuments()
    documents.test_identities.identity_01.activeLeaseId = 'lease_other'
    const db = new MemoryDb(documents)
    const store = createTestLeaseStore(db)

    await expect(store.claim({ leaseId: 'lease_01', issuanceId: 'issuance_01', now: NOW }))
      .rejects
      .toMatchObject({ code: 'identity_binding_invalid' })
    expect(db.get('test_ticket_issuances', 'issuance_01').status).toBe('reserved')
  })

  it('persists encrypted escrow only from minting and never overwrites minted with uncertain', async () => {
    const documents = validDocuments()
    documents.test_ticket_issuances.issuance_01.status = 'minting'
    const db = new MemoryDb(documents)
    const store = createTestLeaseStore(db)

    await store.persistMinted({
      leaseId: 'lease_01',
      issuanceId: 'issuance_01',
      ...escrowFields(),
      now: NOW,
    })
    await store.markUncertain({ leaseId: 'lease_01', issuanceId: 'issuance_01', now: NOW + 1 })

    expect(db.get('test_ticket_issuances', 'issuance_01')).toMatchObject({
      status: 'minted',
      ...escrowFields(),
    })
  })
})

function validDocuments() {
  const target = {
    platformAppId: 'app_01',
    origin: 'https://wish.example.test',
    serviceAudience: 'ai-runtime',
    billingAppId: 'everything-generator',
    scopeIds: ['wish'],
    allowedActions: ['wish:audit', 'wish:finalize'],
  }
  return {
    test_ticket_issuances: {
      issuance_01: {
        _id: 'issuance_01',
        leaseId: 'lease_01',
        grantId: 'grant_01',
        exchangeId: 'exchange_01',
        status: 'reserved',
        escrowExpiresAt: NOW + 90_000,
      },
    },
    test_identity_leases: {
      lease_01: {
        _id: 'lease_01',
        identityId: 'identity_01',
        effectiveUid: 'test_uid_01',
        target,
        status: 'active',
        expiresAt: NOW + 600_000,
        policySnapshot: { identityVersion: 7 },
        usage: { ticketSlotsReserved: 1 },
      },
    },
    test_identities: {
      identity_01: {
        _id: 'identity_01',
        uid: 'test_uid_01',
        synthetic: true,
        status: 'leased',
        activeLeaseId: 'lease_01',
        version: 7,
      },
    },
    test_login_grants: {
      grant_01: {
        _id: 'grant_01',
        leaseId: 'lease_01',
        identityId: 'identity_01',
        target,
        status: 'consuming',
        exchangeId: 'exchange_01',
      },
    },
  }
}

function escrowFields() {
  return {
    ticketCiphertext: 'ciphertext',
    ticketIv: '1234567890123456',
    ticketTag: '1234567890123456789012',
    ticketExpiresAt: NOW + 600_000,
  }
}

class MemoryDb {
  constructor(documents) {
    this.documents = structuredClone(documents)
  }

  get(collection, id) {
    return structuredClone(this.documents[collection]?.[id])
  }

  collection(name) {
    return this.ref(name)
  }

  ref(name) {
    return {
      doc: id => ({
        get: async () => ({ data: this.get(name, id) ? [this.get(name, id)] : [] }),
        update: async (value) => {
          if (!this.documents[name]?.[id])
            return { updated: 0 }
          Object.assign(this.documents[name][id], structuredClone(value))
          return { updated: 1 }
        },
      }),
    }
  }

  async runTransaction(callback) {
    return callback({ collection: name => this.ref(name) })
  }
}
