import { describe, expect, it } from 'vitest'
import { DeviceAuthorizationError, deviceAuthorizationResult } from '../../app/utils/device-authorization'

describe('device authorization page responses', () => {
  it('shows an actionable expiry message instead of a CloudBase invocation failure', () => {
    expect(() => deviceAuthorizationResult({ ok: false, error: { code: 'device_code_expired' } }))
      .toThrow('授权码已过期，请回到小云或原应用重新发起授权，再打开新的链接。')
  })

  it('preserves success payloads and requires a new login when the session expires', () => {
    const device = { appId: 'el-bot', scope: ['ai:agent'] }
    expect(deviceAuthorizationResult(device)).toBe(device)
    expect(deviceAuthorizationResult({ ok: true })).toEqual({ ok: true })
    expect(() => deviceAuthorizationResult({ ok: false, error: { code: 'login_required' } }))
      .toThrow(DeviceAuthorizationError)
  })

  it('does not display unexpected server details from an error result', () => {
    expect(() => deviceAuthorizationResult({ ok: false, error: { code: 'unexpected-secret-details', message: 'private-internal-data' } }))
      .toThrow('授权请求暂不可用，请重新发起或稍后再试。')
  })
})
