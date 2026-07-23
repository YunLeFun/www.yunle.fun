import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { createDesktopClientRegistry } from '../../cloudfunctions/desktop-auth/lib/client-registry.js'
import {
  approveDevice,
  denyDevice,
  describeDevice,
  pollDeviceToken,
  startDeviceAuth,
} from '../../cloudfunctions/desktop-auth/lib/device-codes.js'
import { DEVICE_CODES_COLLECTION } from '../../cloudfunctions/desktop-auth/lib/validation.js'
import { deviceJwkThumbprint } from '../../packages/authorization-core/src/index'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = 1_700_000_000_000
const registry = createDesktopClientRegistry({ issuerEnvironment: 'production' })
const DEVICE_PUBLIC_JWK = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
  .publicKey
  .export({ format: 'jwk' })
const DEVICE_JKT = deviceJwkThumbprint(DEVICE_PUBLIC_JWK)
const ISSUED = { deviceRefreshToken: 'rt-token' }
const issueGrant = async () => ISSUED

async function start(db, overrides = {}) {
  return startDeviceAuth(db, {
    clientId: 'skykeeper-desktop',
    scope: ['membership:read'],
    devicePublicJwk: DEVICE_PUBLIC_JWK,
    deviceName: 'Test-PC',
    ...overrides,
  }, { now: NOW, registry })
}

describe('startDeviceAuth', () => {
  it('derives appId/deviceId and persists only code hashes', async () => {
    const db = makeFakeDb({})
    const res = await start(db)
    expect(res.deviceCode).toMatch(/^[\w-]+$/)
    expect(res.userCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    expect(res.verificationUriComplete).toContain('?code=')

    const doc = db._store[DEVICE_CODES_COLLECTION][0]
    expect(doc).toMatchObject({
      status: 'pending',
      issuer: 'https://www.yunle.fun',
      clientId: 'skykeeper-desktop',
      appId: 'skykeeper',
      scopes: ['membership:read'],
      deviceId: DEVICE_JKT,
      deviceJkt: DEVICE_JKT,
    })
    expect(JSON.stringify(doc)).not.toContain(res.deviceCode)
    expect(JSON.stringify(doc)).not.toContain(res.userCode.replace('-', ''))
  })

  it('does not accept caller-controlled appId or a missing/expanded scope', async () => {
    const db = makeFakeDb({})
    await expect(start(db, { appId: 'attacker' })).rejects.toMatchObject({ code: 'invalid_request' })
    await expect(start(db, { scope: undefined })).rejects.toMatchObject({ code: 'invalid_scope' })
    await expect(start(db, { scope: ['coin'] })).rejects.toMatchObject({ code: 'invalid_scope' })
  })
})

describe('describe / approve / deny', () => {
  it('returns registered display data and explicit consent scopes', async () => {
    const db = makeFakeDb({})
    const res = await start(db)
    await expect(describeDevice(db, { userCode: res.userCode }, { now: NOW }))
      .resolves
      .toMatchObject({
        clientId: 'skykeeper-desktop',
        appId: 'skykeeper',
        displayName: 'Skykeeper',
        scope: ['membership:read'],
        consent: 'explicit',
        status: 'pending',
      })
  })

  it('binds the subject once and cannot resurrect a denied code', async () => {
    const db = makeFakeDb({})
    const approved = await start(db)
    await approveDevice(db, { userCode: approved.userCode, uid: 'u1' }, { now: NOW })
    expect(db._store[DEVICE_CODES_COLLECTION][0]).toMatchObject({ status: 'approved', subject: 'u1' })

    const denied = await start(db)
    await denyDevice(db, { userCode: denied.userCode }, { now: NOW })
    await expect(approveDevice(db, { userCode: denied.userCode, uid: 'u1' }, { now: NOW }))
      .rejects
      .toMatchObject({ code: 'device_code_not_pending' })
  })
})

describe('pollDeviceToken', () => {
  it('is proof-bound, rate limited and consumed at most once', async () => {
    const db = makeFakeDb({})
    const res = await start(db)

    await expect(pollDeviceToken(db, {
      deviceCode: res.deviceCode,
      proofJkt: 'wrong',
    }, { now: NOW, issueGrant })).rejects.toMatchObject({ code: 'device_code_binding_invalid' })

    expect(await pollDeviceToken(db, {
      deviceCode: res.deviceCode,
      proofJkt: DEVICE_JKT,
    }, { now: NOW, issueGrant })).toMatchObject({ status: 'pending' })

    expect(await pollDeviceToken(db, {
      deviceCode: res.deviceCode,
      proofJkt: DEVICE_JKT,
    }, { now: NOW + 1_000, issueGrant })).toMatchObject({ status: 'slow_down' })

    await approveDevice(db, { userCode: res.userCode, uid: 'u1' }, { now: NOW + 2_000 })
    expect(await pollDeviceToken(db, {
      deviceCode: res.deviceCode,
      proofJkt: DEVICE_JKT,
    }, { now: NOW + 6_000, issueGrant })).toMatchObject({
      status: 'approved',
      grant: {
        clientId: 'skykeeper-desktop',
        appId: 'skykeeper',
        subject: 'u1',
        scopes: ['membership:read'],
        deviceJkt: DEVICE_JKT,
      },
      ...ISSUED,
    })

    expect(await pollDeviceToken(db, {
      deviceCode: res.deviceCode,
      proofJkt: DEVICE_JKT,
    }, { now: NOW + 12_000, issueGrant })).toEqual({ status: 'expired' })
  })
})
