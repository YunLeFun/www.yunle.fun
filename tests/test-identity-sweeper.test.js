import { Buffer } from 'node:buffer'
import { createHash, createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

import {
  ADMIN_SWEEP_URL,
  invokeAdminSweep,
} from '../cloudfunctions/test-identity-sweeper/index.js'

const NOW = Date.UTC(2026, 6, 17)
const KEY = Buffer.alloc(32, 7).toString('base64')

describe('test identity timer sweeper', () => {
  it('leaves enough time for the multi-step admin cleanup request', async () => {
    const signal = new AbortController().signal
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(signal)
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => validSweepResult(),
    }))

    await invokeAdminSweep({ fetchImpl, key: KEY, nonce: 'nonce-fixed-01', now: NOW })

    expect(timeout).toHaveBeenCalledWith(25_000)
    timeout.mockRestore()
  })

  it('calls only the fixed admin endpoint with an exact body-bound HMAC', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => validSweepResult(),
    }))

    await expect(invokeAdminSweep({
      fetchImpl,
      key: KEY,
      nonce: 'nonce-fixed-01',
      now: NOW,
    })).resolves.toMatchObject({ ok: true, cleanupRuns: 0 })

    const [url, request] = fetchImpl.mock.calls[0]
    expect(url).toBe(ADMIN_SWEEP_URL)
    expect(request.body).toBe('{}')
    expect(request.redirect).toBe('error')
    const bodyDigest = createHash('sha256').update('{}').digest('hex')
    const expected = createHmac('sha256', Buffer.from(KEY, 'base64'))
      .update(`${NOW}\nnonce-fixed-01\n${bodyDigest}`)
      .digest('base64url')
    expect(request.headers).toMatchObject({
      'content-type': 'application/json',
      'x-sweep-nonce': 'nonce-fixed-01',
      'x-sweep-signature': expected,
      'x-sweep-timestamp': String(NOW),
    })
  })

  it('fails closed on invalid keys and unsuccessful admin responses', async () => {
    await expect(invokeAdminSweep({ key: '', fetchImpl: vi.fn(), now: NOW, nonce: 'nonce-fixed-01' }))
      .rejects
      .toThrow(/32-byte/)
    await expect(invokeAdminSweep({
      key: KEY,
      now: NOW,
      nonce: 'nonce-fixed-01',
      fetchImpl: vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })),
    })).rejects.toThrow(/503/)
  })
})

function validSweepResult() {
  return {
    released: [],
    cleanupRuns: 0,
    ticketIssuancesReconciled: 0,
    purged: [],
    reconciled: {
      scanned: 0,
      settled: 0,
      released: 0,
      manual: 0,
      skipped: 0,
      errors: 0,
      dailyScanned: 1,
      dailyRepaired: 0,
      dailySkipped: 1,
    },
  }
}
