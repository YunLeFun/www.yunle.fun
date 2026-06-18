import { describe, expect, it } from 'vitest'

import { sha256hex } from '../../cloudfunctions/desktop-auth/lib/crypto.js'
import {
  approveDevice,
  denyDevice,
  describeDevice,
  pollDeviceToken,
  startDeviceAuth,
} from '../../cloudfunctions/desktop-auth/lib/device-codes.js'
import { DEVICE_CODES_COLLECTION } from '../../cloudfunctions/desktop-auth/lib/validation.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = 1_700_000_000_000
const DEVICE_ID = 'device-abcdef12'
const ISSUED = { entitlement: 'ent-token', deviceRefreshToken: 'rt-token', account: { coin: 5, membership: { isActive: true } } }
const onApproved = async () => ISSUED

async function start(db, overrides = {}) {
  return startDeviceAuth(db, { appId: 'skykeeper', deviceId: DEVICE_ID, deviceName: 'Test-PC', ...overrides }, { now: NOW })
}

describe('startDeviceAuth', () => {
  it('返回设备码/短码/校验地址，且只存哈希', async () => {
    const db = makeFakeDb({})
    const res = await start(db)
    expect(res.deviceCode).toMatch(/^[\w-]+$/)
    expect(res.userCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    expect(res.verificationUriComplete).toContain('?code=')
    expect(res.interval).toBeGreaterThan(0)

    const doc = db._store[DEVICE_CODES_COLLECTION][0]
    expect(doc.status).toBe('pending')
    expect(doc.uid).toBeNull()
    expect(doc.deviceCodeHash).toBe(sha256hex(res.deviceCode))
    // 明文设备码绝不落库
    expect(JSON.stringify(doc)).not.toContain(res.deviceCode)
  })

  it('非法 appId / deviceId → 抛错', async () => {
    const db = makeFakeDb({})
    await expect(start(db, { appId: 'Bad App!' })).rejects.toThrow(/appId/)
    await expect(start(db, { deviceId: 'short' })).rejects.toThrow(/deviceId/)
  })
})

describe('describe / approve / deny', () => {
  it('describeDevice 返回应用信息', async () => {
    const db = makeFakeDb({})
    const res = await start(db)
    const info = await describeDevice(db, { userCode: res.userCode }, { now: NOW })
    expect(info).toMatchObject({ appId: 'skykeeper', deviceName: 'Test-PC', status: 'pending' })
    expect(info.scope).toEqual(['membership', 'coin'])
  })

  it('approveDevice 拒绝匿名 uid', async () => {
    const db = makeFakeDb({})
    const res = await start(db)
    await expect(approveDevice(db, { userCode: res.userCode, uid: 'anon' }, { now: NOW })).rejects.toThrow(/请先登录/)
    await expect(approveDevice(db, { userCode: res.userCode, uid: '' }, { now: NOW })).rejects.toThrow(/请先登录/)
  })

  it('approveDevice 绑定 uid', async () => {
    const db = makeFakeDb({})
    const res = await start(db)
    await approveDevice(db, { userCode: res.userCode, uid: 'u1' }, { now: NOW })
    const doc = db._store[DEVICE_CODES_COLLECTION][0]
    expect(doc.status).toBe('approved')
    expect(doc.uid).toBe('u1')
  })

  it('denyDevice 置为 denied', async () => {
    const db = makeFakeDb({})
    const res = await start(db)
    await denyDevice(db, { userCode: res.userCode }, { now: NOW })
    expect(db._store[DEVICE_CODES_COLLECTION][0].status).toBe('denied')
  })

  it('过期设备码 describe/approve 抛错', async () => {
    const db = makeFakeDb({})
    const res = await start(db)
    const later = NOW + 11 * 60 * 1000 // 默认 10min TTL
    await expect(describeDevice(db, { userCode: res.userCode }, { now: later })).rejects.toThrow(/过期/)
    await expect(approveDevice(db, { userCode: res.userCode, uid: 'u1' }, { now: later })).rejects.toThrow(/过期/)
  })
})

describe('pollDeviceToken', () => {
  it('未授权 → pending', async () => {
    const db = makeFakeDb({})
    const res = await start(db)
    const poll = await pollDeviceToken(db, { deviceCode: res.deviceCode, deviceId: DEVICE_ID }, { now: NOW, onApproved })
    expect(poll.status).toBe('pending')
  })

  it('deviceId 不匹配 → expired（不泄露）', async () => {
    const db = makeFakeDb({})
    const res = await start(db)
    const poll = await pollDeviceToken(db, { deviceCode: res.deviceCode, deviceId: 'wrong-device-xx' }, { now: NOW, onApproved })
    expect(poll.status).toBe('expired')
  })

  it('授权后 → approved 带凭证，且变一次性（再次轮询 expired）', async () => {
    const db = makeFakeDb({})
    const res = await start(db)
    await approveDevice(db, { userCode: res.userCode, uid: 'u1' }, { now: NOW })

    const poll = await pollDeviceToken(db, { deviceCode: res.deviceCode, deviceId: DEVICE_ID }, { now: NOW + 6000, onApproved })
    expect(poll).toMatchObject({ status: 'approved', ...ISSUED })
    expect(db._store[DEVICE_CODES_COLLECTION][0].status).toBe('consumed')

    const again = await pollDeviceToken(db, { deviceCode: res.deviceCode, deviceId: DEVICE_ID }, { now: NOW + 12_000, onApproved })
    expect(again.status).toBe('expired')
  })

  it('轮询过快 → slow_down', async () => {
    const db = makeFakeDb({})
    const res = await start(db)
    await pollDeviceToken(db, { deviceCode: res.deviceCode, deviceId: DEVICE_ID }, { now: NOW, onApproved })
    const fast = await pollDeviceToken(db, { deviceCode: res.deviceCode, deviceId: DEVICE_ID }, { now: NOW + 1000, onApproved })
    expect(fast.status).toBe('slow_down')
  })

  it('过期设备码轮询 → expired', async () => {
    const db = makeFakeDb({})
    const res = await start(db)
    const poll = await pollDeviceToken(db, { deviceCode: res.deviceCode, deviceId: DEVICE_ID }, { now: NOW + 11 * 60 * 1000, onApproved })
    expect(poll.status).toBe('expired')
  })
})
