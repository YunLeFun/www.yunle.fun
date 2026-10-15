import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { ACQUISITION_WRITE_TIMEOUT_MS, recordSsoAcquisition } = createRequire(import.meta.url)('../../cloudfunctions/sso-ticket/acquisition.js')
let output

beforeEach(() => {
  output = vi.fn()
  vi.spyOn(console, 'info').mockImplementation(output)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('sSO acquisition proxy', () => {
  it('uses the authenticated UID and Registry decision rather than caller application fields', async () => {
    const call = vi.fn(async () => ({ ok: true, status: 'recorded' }))
    const context = { version: 1, firstTouch: { utmSource: 'zhihu' } }
    await recordSsoAcquisition(call, {
      serviceToken: 'private-test-token',
      userId: 'trusted-user',
      request: { appId: 'cook', clientId: 'cook-web', targetOrigin: 'https://cook.yunyoujun.cn' },
      payload: { appId: 'forged', userId: 'forged', acquisition: context, acquisitionAuthMethod: 'phone_otp' },
    })
    expect(call).toHaveBeenCalledWith({
      action: 'recordUserAcquisitionForSso',
      serviceToken: 'private-test-token',
      userId: 'trusted-user',
      entry: { appId: 'cook', clientId: 'cook-web', origin: 'https://cook.yunyoujun.cn' },
      context,
      authMethod: 'phone_otp',
    })
    expect(output).toHaveBeenCalledWith('[acquisition]', { surface: 'sso', trigger: 'authorization', outcome: 'recorded', attempts: 1 })
  })

  it('keeps source write failures separate from successful authorization and does not log inputs', async () => {
    const result = await recordSsoAcquisition(async () => {
      throw new Error('secret-error')
    }, {
      serviceToken: 'private-test-token',
      userId: 'trusted-user',
      request: {},
      payload: {},
    })
    expect(result).toEqual({ ok: false })
    expect(output).toHaveBeenCalledWith('[acquisition]', { surface: 'sso', trigger: 'authorization', outcome: 'transport_failure', attempts: 1 })
    expect(JSON.stringify(output.mock.calls)).not.toMatch(/secret-error|private-test-token|trusted-user/)
  })

  it('returns before the SSO function deadline when the analytics transport never completes', async () => {
    vi.useFakeTimers()
    const completed = recordSsoAcquisition(() => new Promise(() => {}), {
      serviceToken: 'private-test-token',
      userId: 'trusted-user',
      request: { appId: 'cook', clientId: 'cook-web', targetOrigin: 'https://cook.yunyoujun.cn' },
      payload: {},
    })
    await vi.advanceTimersByTimeAsync(ACQUISITION_WRITE_TIMEOUT_MS)
    await expect(completed).resolves.toEqual({ ok: false })
    expect(vi.getTimerCount()).toBe(0)
    expect(output).toHaveBeenCalledWith('[acquisition]', { surface: 'sso', trigger: 'authorization', outcome: 'timeout', attempts: 1 })
  })

  it.each([
    [{ ok: false, statusCode: 403, retryable: false, error: 'raw private error' }, 'terminal_failure'],
    [{ ok: false, statusCode: 503, retryable: true }, 'retryable_failure'],
    [{ ok: false, statusCode: 503, retryable: false }, 'terminal_failure'],
    [{ ok: true, status: 'existing' }, 'existing'],
  ])('logs the safe result but performs a single awaited call for %j', async (reply, outcome) => {
    const call = vi.fn().mockResolvedValue(reply)
    await recordSsoAcquisition(call, { serviceToken: 'private-test-token', userId: 'trusted-user', request: {}, payload: {} })
    expect(call).toHaveBeenCalledTimes(1)
    expect(output).toHaveBeenCalledWith('[acquisition]', { surface: 'sso', trigger: 'authorization', outcome, attempts: 1, ...(reply.statusCode ? { statusCode: reply.statusCode } : {}) })
    expect(JSON.stringify(output.mock.calls)).not.toMatch(/private|token|trusted-user/)
  })

  it('identifies missing service configuration without a request or raw configuration logs', async () => {
    const call = vi.fn()
    await expect(recordSsoAcquisition(call, { userId: 'trusted-user', request: {}, payload: {} })).resolves.toEqual({ ok: false })
    expect(call).not.toHaveBeenCalled()
    expect(output).toHaveBeenCalledWith('[acquisition]', { surface: 'sso', trigger: 'authorization', outcome: 'not_configured', attempts: 0 })
  })
})
