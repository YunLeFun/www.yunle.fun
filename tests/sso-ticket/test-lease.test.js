import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'

import {
  ESCROW_AAD,
  mintForTestLease,
  TestLeaseMintError,
  validateMintContext,
} from '../../cloudfunctions/sso-ticket/test-lease.js'

const NOW = Date.UTC(2026, 6, 17)
const LEASE_ID = 'lease_01'
const ISSUANCE_ID = 'issuance_01'
const ESCROW_KEY = crypto.randomBytes(32).toString('base64')

describe('sso-ticket test lease minting', () => {
  it('rejects an invalid broker token before reading broker state', async () => {
    const deps = fakeDeps()

    await expect(mintForTestLease({
      serviceToken: 'wrong-token',
      leaseId: LEASE_ID,
      issuanceId: ISSUANCE_ID,
    }, deps)).resolves.toEqual({ ok: false, reason: 'forbidden', definitive: true })

    expect(deps.claimCalls).toBe(0)
  })

  it('claims a reserved issuance, creates a lease-bounded ticket, and persists only ciphertext', async () => {
    const deps = fakeDeps()
    const result = await mintForTestLease(validInput(), deps)

    expect(result).toEqual({ ok: true })
    expect(deps.createCalls).toBe(1)
    expect(deps.ticketOptions).toEqual({ refresh: 10 * 60_000, expire: NOW + 10 * 60_000 })
    expect(deps.persisted).toMatchObject({
      leaseId: LEASE_ID,
      issuanceId: ISSUANCE_ID,
      ticketExpiresAt: NOW + 10 * 60_000,
    })
    expect(JSON.stringify(deps.persisted)).not.toContain('cloudbase-ticket-secret')
    expect(decryptEscrow(deps.persisted, ESCROW_KEY)).toBe('cloudbase-ticket-secret')
  })

  it('does not mint again when the issuance was already escrowed', async () => {
    const deps = fakeDeps({ claim: { kind: 'minted' } })

    await expect(mintForTestLease(validInput(), deps)).resolves.toEqual({ ok: true })
    expect(deps.createCalls).toBe(0)
  })

  it('waits for a concurrent claimant and reuses its minted escrow', async () => {
    const deps = fakeDeps({ claim: { kind: 'minting' }, waitResult: { kind: 'minted' } })

    await expect(mintForTestLease(validInput(), deps)).resolves.toEqual({ ok: true })
    expect(deps.createCalls).toBe(0)
  })

  it('marks an issuance uncertain if ticket escrow persistence fails after signing', async () => {
    const deps = fakeDeps({ persistError: new Error('database unavailable') })

    await expect(mintForTestLease(validInput(), deps)).resolves.toEqual({
      ok: false,
      reason: 'ticket_escrow_uncertain',
      definitive: false,
    })
    expect(deps.markedUncertain).toBe(true)
    expect(deps.createCalls).toBe(1)
  })

  it('treats a createTicket failure as definitive and never writes an escrow', async () => {
    const deps = fakeDeps({ createError: new Error('invalid signing key') })

    await expect(mintForTestLease(validInput(), deps)).resolves.toEqual({
      ok: false,
      reason: 'ticket_create_failed',
      definitive: true,
    })
    expect(deps.persisted).toBeUndefined()
    expect(deps.markedExpired).toBe(true)
  })
})

describe('sso-ticket broker-state validation', () => {
  it('accepts a fully bound active lease context', () => {
    expect(validateMintContext(validContext(), LEASE_ID, ISSUANCE_ID, NOW)).toMatchObject({
      uid: 'test_uid_01',
      expiresAt: NOW + 10 * 60_000,
    })
  })

  it('keeps using the immutable lease snapshot after the identity policy version advances', () => {
    expect(validateMintContext(
      mergeContext(validContext(), { identity: { version: 8 } }),
      LEASE_ID,
      ISSUANCE_ID,
      NOW,
    )).toMatchObject({ uid: 'test_uid_01' })
  })

  it.each([
    ['inactive lease', { lease: { status: 'closed' } }],
    ['identity pointer mismatch', { identity: { activeLeaseId: 'lease_other' } }],
    ['missing policy snapshot version', { lease: { policySnapshot: { identityVersion: null } } }],
    ['grant exchange mismatch', { grant: { exchangeId: 'exchange_other' } }],
    ['unreserved ticket slot', { lease: { usage: { ticketSlotsReserved: 0 } } }],
    ['fractional lease expiry', { lease: { expiresAt: NOW + 600_000.5 } }],
    ['lease longer than 15 minutes', { lease: { expiresAt: NOW + 16 * 60_000 } }],
  ])('fails closed for %s', (_label, patch) => {
    expect(() => validateMintContext(mergeContext(validContext(), patch), LEASE_ID, ISSUANCE_ID, NOW))
      .toThrow(TestLeaseMintError)
  })
})

function validInput() {
  return {
    serviceToken: 'broker-token',
    leaseId: LEASE_ID,
    issuanceId: ISSUANCE_ID,
  }
}

function validContext() {
  const target = {
    platformAppId: 'app_01',
    origin: 'https://wish.example.test',
    serviceAudience: 'ai-gateway',
    billingAppId: 'everything-generator',
    scopeIds: ['wish'],
    allowedActions: ['wish:audit', 'wish:finalize'],
  }
  return {
    issuance: {
      _id: ISSUANCE_ID,
      leaseId: LEASE_ID,
      grantId: 'grant_01',
      exchangeId: 'exchange_01',
      status: 'reserved',
      escrowExpiresAt: NOW + 90_000,
    },
    lease: {
      _id: LEASE_ID,
      identityId: 'identity_01',
      effectiveUid: 'test_uid_01',
      target,
      status: 'active',
      expiresAt: NOW + 10 * 60_000,
      policySnapshot: { identityVersion: 7 },
      usage: { ticketSlotsReserved: 1 },
    },
    identity: {
      _id: 'identity_01',
      uid: 'test_uid_01',
      synthetic: true,
      status: 'leased',
      activeLeaseId: LEASE_ID,
      version: 7,
    },
    grant: {
      _id: 'grant_01',
      leaseId: LEASE_ID,
      identityId: 'identity_01',
      target,
      status: 'consuming',
      exchangeId: 'exchange_01',
    },
  }
}

function mergeContext(context, patch) {
  const clone = structuredClone(context)
  for (const [key, value] of Object.entries(patch))
    clone[key] = deepMerge(clone[key], value)
  return clone
}

function deepMerge(base, patch) {
  if (!base || !patch || Array.isArray(base) || Array.isArray(patch))
    return patch
  const result = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    result[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? deepMerge(result[key], value)
      : value
  }
  return result
}

function fakeDeps(options = {}) {
  const deps = {
    expectedToken: 'broker-token',
    escrowKey: ESCROW_KEY,
    now: () => NOW,
    claimCalls: 0,
    createCalls: 0,
    async claim() {
      this.claimCalls += 1
      return options.claim || { kind: 'claimed', ...validateMintContext(validContext(), LEASE_ID, ISSUANCE_ID, NOW) }
    },
    async waitForMinted() {
      return options.waitResult || { kind: 'minting' }
    },
    createTicket(_uid, ticketOptions) {
      this.createCalls += 1
      this.ticketOptions = ticketOptions
      if (options.createError)
        throw options.createError
      return 'cloudbase-ticket-secret'
    },
    async persistMinted(value) {
      if (options.persistError)
        throw options.persistError
      this.persisted = value
    },
    async markUncertain() {
      this.markedUncertain = true
    },
    async markExpired() {
      this.markedExpired = true
    },
  }
  return deps
}

function decryptEscrow(value, key) {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    Buffer.from(key, 'base64'),
    Buffer.from(value.ticketIv, 'base64url'),
  )
  decipher.setAAD(Buffer.from(ESCROW_AAD, 'utf8'))
  decipher.setAuthTag(Buffer.from(value.ticketTag, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(value.ticketCiphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}
