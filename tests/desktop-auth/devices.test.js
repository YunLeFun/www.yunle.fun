import { describe, expect, it } from 'vitest'

import {
  issueDeviceGrant,
  refreshDeviceGrant,
  revokeDevice,
} from '../../cloudfunctions/desktop-auth/lib/devices.js'
import {
  DEVICES_COLLECTION,
  REFRESH_TOKENS_COLLECTION,
} from '../../cloudfunctions/desktop-auth/lib/validation.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = 1_700_000_000_000
const GRANT = {
  subject: 'u1',
  issuer: 'https://www.yunle.fun',
  clientId: 'skykeeper-desktop',
  appId: 'skykeeper',
  scopes: ['membership:read'],
  deviceId: 'thumbprint-abcdef',
  deviceJkt: 'thumbprint-abcdef',
  authorizedAt: NOW,
  registrationFingerprint: 'fingerprint-v1',
}
const registry = {
  reauthorize: record => ({
    ...record,
    registrationFingerprint: 'fingerprint-v1',
  }),
}
async function buildEntitlement({ subject }) {
  return {
    entitlement: `ent-for-${subject}`,
    membership: { level: 'pro', expiresAt: NOW + 10_000 },
  }
}

async function issue(db) {
  return db.runTransaction(transaction => issueDeviceGrant(transaction, GRANT, {
    now: NOW,
    generateGrantId: () => 'grant-1',
    generateToken: () => 'refresh-token-1',
  }))
}

describe('device refresh grants', () => {
  it('stores only a token hash with 30-day idle and 180-day absolute limits', async () => {
    const db = makeFakeDb({})
    const { deviceRefreshToken } = await issue(db)
    expect(deviceRefreshToken).toBe('refresh-token-1')

    expect(db._store[REFRESH_TOKENS_COLLECTION][0]).toMatchObject({
      status: 'active',
      grantId: 'grant-1',
      clientId: 'skykeeper-desktop',
      appId: 'skykeeper',
      idleExpiresAt: NOW + 30 * 24 * 3600 * 1000,
      absoluteExpiresAt: NOW + 180 * 24 * 3600 * 1000,
    })
    expect(JSON.stringify(db._store)).not.toContain(deviceRefreshToken)
  })

  it('rotates a proof-bound token and preserves the absolute deadline', async () => {
    const db = makeFakeDb({})
    const { deviceRefreshToken } = await issue(db)
    const result = await refreshDeviceGrant(db, {
      deviceRefreshToken,
      proofJkt: GRANT.deviceJkt,
    }, {
      now: NOW + 1_000,
      registry,
      buildEntitlement,
      generateToken: () => 'refresh-token-2',
    })

    expect(result).toEqual({
      deviceRefreshToken: 'refresh-token-2',
      entitlement: 'ent-for-u1',
      membership: { level: 'pro', expiresAt: NOW + 10_000 },
    })
    const [first, second] = db._store[REFRESH_TOKENS_COLLECTION]
    expect(first.status).toBe('used')
    expect(second).toMatchObject({
      status: 'active',
      absoluteExpiresAt: first.absoluteExpiresAt,
    })
  })

  it('revokes the whole grant family when any used token is replayed', async () => {
    const db = makeFakeDb({})
    const { deviceRefreshToken } = await issue(db)
    await refreshDeviceGrant(db, {
      deviceRefreshToken,
      proofJkt: GRANT.deviceJkt,
    }, {
      now: NOW + 1_000,
      registry,
      buildEntitlement,
      generateToken: () => 'refresh-token-2',
    })

    await expect(refreshDeviceGrant(db, {
      deviceRefreshToken,
      proofJkt: GRANT.deviceJkt,
    }, {
      now: NOW + 2_000,
      registry,
      buildEntitlement,
    })).rejects.toMatchObject({ code: 'refresh_reused' })

    expect(db._store[REFRESH_TOKENS_COLLECTION].every(record => record.status === 'revoked')).toBe(true)
    expect(db._store[DEVICES_COLLECTION][0].revokedAt).toBe(NOW + 2_000)
  })

  it('rejects another installation key and changed registry policy', async () => {
    const db = makeFakeDb({})
    const { deviceRefreshToken } = await issue(db)
    await expect(refreshDeviceGrant(db, {
      deviceRefreshToken,
      proofJkt: 'another-key',
    }, { now: NOW + 1_000, registry, buildEntitlement }))
      .rejects
      .toMatchObject({ code: 'refresh_binding_invalid' })

    await expect(refreshDeviceGrant(db, {
      deviceRefreshToken,
      proofJkt: GRANT.deviceJkt,
    }, {
      now: NOW + 1_000,
      registry: { reauthorize: () => { throw Object.assign(new Error('registry policy changed'), { code: 'client_policy_changed' }) } },
      buildEntitlement,
    })).rejects.toMatchObject({ code: 'client_policy_changed' })
  })
})

describe('device revocation', () => {
  it('revokes by server-known client and device identifiers', async () => {
    const db = makeFakeDb({})
    await issue(db)
    await expect(revokeDevice(db, {
      uid: 'u1',
      clientId: 'skykeeper-desktop',
      deviceId: GRANT.deviceId,
    }, { now: NOW + 1 })).resolves.toEqual({ revoked: true })
    expect(db._store[REFRESH_TOKENS_COLLECTION][0].status).toBe('revoked')
  })
})
