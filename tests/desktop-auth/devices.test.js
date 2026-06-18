import { describe, expect, it } from 'vitest'

import { sha256hex } from '../../cloudfunctions/desktop-auth/lib/crypto.js'
import {
  refreshEntitlement,
  registerDevice,
  revokeDevice,
} from '../../cloudfunctions/desktop-auth/lib/devices.js'
import { DEVICES_COLLECTION } from '../../cloudfunctions/desktop-auth/lib/validation.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = 1_700_000_000_000
const DEVICE_ID = 'device-abcdef12'
const REG = { uid: 'u1', appId: 'skykeeper', deviceId: DEVICE_ID, deviceName: 'PC', scope: ['membership', 'coin'] }
const buildEntitlement = async ({ uid }) => ({ entitlement: `ent-for-${uid}`, account: { coin: 9, membership: { isActive: true } } })

describe('registerDevice', () => {
  it('签发 refreshToken 并只存哈希', async () => {
    const db = makeFakeDb({})
    const { refreshToken } = await registerDevice(db, REG, { now: NOW })
    expect(refreshToken).toMatch(/^[\w-]+$/)
    const doc = db._store[DEVICES_COLLECTION][0]
    expect(doc.refreshTokenHash).toBe(sha256hex(refreshToken))
    expect(doc.revokedAt).toBeNull()
    expect(JSON.stringify(doc)).not.toContain(refreshToken)
  })

  it('同一 (uid,appId,deviceId) 重复注册 = 重置（不新增记录）', async () => {
    const db = makeFakeDb({})
    await registerDevice(db, REG, { now: NOW })
    await registerDevice(db, REG, { now: NOW + 1000 })
    expect(db._store[DEVICES_COLLECTION]).toHaveLength(1)
  })
})

describe('refreshEntitlement', () => {
  it('有效 token → 轮换并重新签发', async () => {
    const db = makeFakeDb({})
    const { refreshToken } = await registerDevice(db, REG, { now: NOW })
    const res = await refreshEntitlement(db, { deviceRefreshToken: refreshToken, deviceId: DEVICE_ID }, { now: NOW + 1000, buildEntitlement })

    expect(res.entitlement).toBe('ent-for-u1')
    expect(res.account).toEqual({ coin: 9, membership: { isActive: true } })
    expect(res.deviceRefreshToken).not.toBe(refreshToken) // 轮换
    const doc = db._store[DEVICES_COLLECTION][0]
    expect(doc.refreshTokenHash).toBe(sha256hex(res.deviceRefreshToken))
    expect(doc.prevRefreshTokenHash).toBe(sha256hex(refreshToken)) // 旧的进 prev
  })

  it('连续刷新形成 token 链', async () => {
    const db = makeFakeDb({})
    const { refreshToken: t1 } = await registerDevice(db, REG, { now: NOW })
    const { deviceRefreshToken: t2 } = await refreshEntitlement(db, { deviceRefreshToken: t1, deviceId: DEVICE_ID }, { now: NOW + 1000, buildEntitlement })
    const { deviceRefreshToken: t3 } = await refreshEntitlement(db, { deviceRefreshToken: t2, deviceId: DEVICE_ID }, { now: NOW + 2000, buildEntitlement })
    expect(t3).not.toBe(t2)
  })

  it('重用检测：旧 token 再次使用 → 吊销整台设备', async () => {
    const db = makeFakeDb({})
    const { refreshToken: t1 } = await registerDevice(db, REG, { now: NOW })
    await refreshEntitlement(db, { deviceRefreshToken: t1, deviceId: DEVICE_ID }, { now: NOW + 1000, buildEntitlement })

    // 再次用已轮换出的 t1 → reuse detected
    await expect(refreshEntitlement(db, { deviceRefreshToken: t1, deviceId: DEVICE_ID }, { now: NOW + 2000, buildEntitlement }))
      .rejects
      .toMatchObject({ code: 'revoked' })
    expect(db._store[DEVICES_COLLECTION][0].revokedAt).toBe(NOW + 2000)
  })

  it('无效 token → invalid_grant', async () => {
    const db = makeFakeDb({})
    await registerDevice(db, REG, { now: NOW })
    await expect(refreshEntitlement(db, { deviceRefreshToken: 'nope', deviceId: DEVICE_ID }, { now: NOW + 1000, buildEntitlement }))
      .rejects
      .toMatchObject({ code: 'invalid_grant' })
  })

  it('已吊销设备 → 拒绝刷新', async () => {
    const db = makeFakeDb({})
    const { refreshToken } = await registerDevice(db, REG, { now: NOW })
    await revokeDevice(db, { uid: 'u1', appId: 'skykeeper', deviceId: DEVICE_ID }, { now: NOW + 500 })
    await expect(refreshEntitlement(db, { deviceRefreshToken: refreshToken, deviceId: DEVICE_ID }, { now: NOW + 1000, buildEntitlement }))
      .rejects
      .toMatchObject({ code: 'invalid_grant' }) // 吊销时清掉了 hash，按无效处理
  })

  it('refresh token 过期 → expired', async () => {
    const db = makeFakeDb({})
    const { refreshToken } = await registerDevice(db, REG, { now: NOW, refreshTtlSec: 1 })
    await expect(refreshEntitlement(db, { deviceRefreshToken: refreshToken, deviceId: DEVICE_ID }, { now: NOW + 5000, buildEntitlement }))
      .rejects
      .toMatchObject({ code: 'expired' })
  })

  it('deviceId 不匹配 → invalid_grant', async () => {
    const db = makeFakeDb({})
    const { refreshToken } = await registerDevice(db, REG, { now: NOW })
    await expect(refreshEntitlement(db, { deviceRefreshToken: refreshToken, deviceId: 'other-device-xx' }, { now: NOW + 1000, buildEntitlement }))
      .rejects
      .toMatchObject({ code: 'invalid_grant' })
  })
})

describe('revokeDevice', () => {
  it('置 revokedAt 并清空 token 哈希', async () => {
    const db = makeFakeDb({})
    await registerDevice(db, REG, { now: NOW })
    const res = await revokeDevice(db, { uid: 'u1', appId: 'skykeeper', deviceId: DEVICE_ID }, { now: NOW + 1 })
    expect(res.revoked).toBe(true)
    const doc = db._store[DEVICES_COLLECTION][0]
    expect(doc.revokedAt).toBe(NOW + 1)
    expect(doc.refreshTokenHash).toBeNull()
  })
})
