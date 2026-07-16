/**
 * Synthetic test-identity ticket minting state machine.
 *
 * The broker supplies only durable identifiers. The CloudBase adapter must
 * atomically validate and claim the reserved issuance before createTicket is
 * called; this module then bounds the ticket to the lease and escrows it.
 */

'use strict'

const { Buffer } = require('node:buffer')
const crypto = require('node:crypto')
const { isValidTicketUid, tokensMatch } = require('./mint')

const ESCROW_AAD = 'yunlefun:test-ticket:v2'
const MAX_LEASE_MILLISECONDS = 15 * 60 * 1000
const REF_RE = /^[\w:-]{4,128}$/

class TestLeaseMintError extends Error {
  constructor(code, message, definitive = true) {
    super(message)
    this.name = 'TestLeaseMintError'
    this.code = code
    this.definitive = definitive
  }
}

function assertRef(value, name) {
  if (typeof value !== 'string' || !REF_RE.test(value))
    throw new TestLeaseMintError('invalid_request', `${name} is invalid`)
  return value
}

function assertStrictBase64Key(raw, name = 'escrow key') {
  if (typeof raw !== 'string' || !/^[A-Z0-9+/]{43}=$/i.test(raw))
    throw new TestLeaseMintError('not_configured', `${name} is not a 32-byte base64 key`)
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32 || key.toString('base64') !== raw)
    throw new TestLeaseMintError('not_configured', `${name} is not a 32-byte base64 key`)
  return key
}

function targetMatches(a, b) {
  return !!a && !!b
    && a.platformAppId === b.platformAppId
    && a.origin === b.origin
    && a.serviceAudience === b.serviceAudience
    && (a.billingAppId || '') === (b.billingAppId || '')
    && Array.isArray(a.scopeIds)
    && Array.isArray(b.scopeIds)
    && a.scopeIds.length === b.scopeIds.length
    && a.scopeIds.every((value, index) => value === b.scopeIds[index])
    && Array.isArray(a.allowedActions)
    && Array.isArray(b.allowedActions)
    && a.allowedActions.length === b.allowedActions.length
    && a.allowedActions.every((value, index) => value === b.allowedActions[index])
}

function validateMintContext(context, leaseId, issuanceId, now) {
  const { issuance, lease, identity, grant } = context || {}
  if (!issuance || issuance._id !== issuanceId || issuance.leaseId !== leaseId)
    throw new TestLeaseMintError('issuance_binding_invalid', 'Issuance binding is invalid')
  if (!lease || lease._id !== leaseId || lease.identityId !== identity?._id)
    throw new TestLeaseMintError('lease_binding_invalid', 'Lease binding is invalid')
  if (lease.status !== 'active' || !Number.isSafeInteger(lease.expiresAt) || lease.expiresAt <= now)
    throw new TestLeaseMintError('lease_inactive', 'Lease is not active')
  const remaining = lease.expiresAt - now
  if (remaining > MAX_LEASE_MILLISECONDS)
    throw new TestLeaseMintError('lease_ttl_invalid', 'Lease ticket lifetime exceeds 15 minutes')
  if (!identity
    || identity.synthetic !== true
    || identity.status !== 'leased'
    || identity.activeLeaseId !== leaseId
    || identity.uid !== lease.effectiveUid
    || !Number.isSafeInteger(identity.version)
    || identity.version < 1
    || !Number.isSafeInteger(lease.policySnapshot?.identityVersion)
    || lease.policySnapshot.identityVersion < 1) {
    throw new TestLeaseMintError('identity_binding_invalid', 'Synthetic identity binding is invalid')
  }
  if (!isValidTicketUid(lease.effectiveUid))
    throw new TestLeaseMintError('uid_invalid', 'Synthetic identity UID is invalid')
  if (!grant
    || grant._id !== issuance.grantId
    || grant.leaseId !== leaseId
    || grant.identityId !== identity._id
    || grant.exchangeId !== issuance.exchangeId
    || (grant.status !== 'consuming' && grant.status !== 'consumed')
    || !targetMatches(grant.target, lease.target)) {
    throw new TestLeaseMintError('grant_binding_invalid', 'Grant binding is invalid')
  }
  if (!Number.isInteger(lease.usage?.ticketSlotsReserved) || lease.usage.ticketSlotsReserved < 1)
    throw new TestLeaseMintError('ticket_slot_missing', 'Ticket slot is not reserved')
  if (!Number.isSafeInteger(issuance.escrowExpiresAt) || issuance.escrowExpiresAt <= now)
    throw new TestLeaseMintError('escrow_expired', 'Ticket escrow has expired')
  return { uid: lease.effectiveUid, expiresAt: lease.expiresAt }
}

function ticketEscrowAad(leaseId, issuanceId) {
  return Buffer.from(`${ESCROW_AAD}\0${assertRef(leaseId, 'leaseId')}\0${assertRef(issuanceId, 'issuanceId')}`, 'utf8')
}

function encryptTicket(ticket, rawKey, context) {
  if (typeof ticket !== 'string' || !ticket)
    throw new TestLeaseMintError('ticket_invalid', 'CloudBase returned an invalid ticket')
  const key = assertStrictBase64Key(rawKey)
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(ticketEscrowAad(context?.leaseId, context?.issuanceId))
  const ciphertext = Buffer.concat([cipher.update(ticket, 'utf8'), cipher.final()])
  return {
    ticketCiphertext: ciphertext.toString('base64url'),
    ticketIv: iv.toString('base64url'),
    ticketTag: cipher.getAuthTag().toString('base64url'),
  }
}

async function safeMark(callback, input) {
  try {
    await callback(input)
  }
  catch {
    // The broker/sweeper owns durable recovery. Never replace the original
    // signing outcome with a secondary status-write failure.
  }
}

async function mintForTestLease(payload, deps) {
  if (typeof deps.expectedToken !== 'string'
    || deps.expectedToken.length < 32
    || deps.expectedToken.length > 512) {
    return { ok: false, reason: 'not_configured', definitive: true }
  }
  if (!tokensMatch(payload?.serviceToken, deps.expectedToken))
    return { ok: false, reason: 'forbidden', definitive: true }

  let leaseId
  let issuanceId
  try {
    leaseId = assertRef(payload?.leaseId, 'leaseId')
    issuanceId = assertRef(payload?.issuanceId, 'issuanceId')
    assertStrictBase64Key(deps.escrowKey)
  }
  catch (error) {
    return errorResult(error)
  }

  const now = deps.now()
  let claim
  try {
    claim = await deps.claim({ leaseId, issuanceId, now })
  }
  catch (error) {
    return errorResult(error, 'broker_state_unavailable', false)
  }

  if (claim.kind === 'minted')
    return { ok: true }
  if (claim.kind === 'minting') {
    try {
      const current = await deps.waitForMinted({ leaseId, issuanceId, now })
      return current.kind === 'minted'
        ? { ok: true }
        : { ok: false, reason: 'ticket_mint_in_progress', definitive: false }
    }
    catch {
      return { ok: false, reason: 'broker_state_unavailable', definitive: false }
    }
  }
  if (claim.kind !== 'claimed')
    return { ok: false, reason: claim.reason || 'issuance_unavailable', definitive: claim.definitive !== false }

  const remaining = claim.expiresAt - now
  if (!(remaining > 0 && remaining <= MAX_LEASE_MILLISECONDS))
    return { ok: false, reason: 'lease_ttl_invalid', definitive: true }

  let ticket
  try {
    ticket = await deps.createTicket(claim.uid, {
      refresh: remaining,
      expire: claim.expiresAt,
    })
    if (typeof ticket !== 'string' || !ticket)
      throw new Error('invalid ticket')
  }
  catch {
    await safeMark(deps.markExpired.bind(deps), { leaseId, issuanceId, now })
    return { ok: false, reason: 'ticket_create_failed', definitive: true }
  }

  let escrow
  try {
    escrow = encryptTicket(ticket, deps.escrowKey, { leaseId, issuanceId })
    await deps.persistMinted({
      leaseId,
      issuanceId,
      ...escrow,
      ticketExpiresAt: claim.expiresAt,
      now: deps.now(),
    })
  }
  catch {
    await safeMark(deps.markUncertain.bind(deps), { leaseId, issuanceId, now: deps.now() })
    return { ok: false, reason: 'ticket_escrow_uncertain', definitive: false }
  }
  finally {
    ticket = undefined
  }

  return { ok: true }
}

function errorResult(error, fallbackReason = 'invalid_request', fallbackDefinitive = true) {
  return {
    ok: false,
    reason: error instanceof TestLeaseMintError ? error.code : fallbackReason,
    definitive: error instanceof TestLeaseMintError ? error.definitive : fallbackDefinitive,
  }
}

module.exports = {
  ESCROW_AAD,
  MAX_LEASE_MILLISECONDS,
  TestLeaseMintError,
  assertStrictBase64Key,
  encryptTicket,
  mintForTestLease,
  ticketEscrowAad,
  validateMintContext,
}
