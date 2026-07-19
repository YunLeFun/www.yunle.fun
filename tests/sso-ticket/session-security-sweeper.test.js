import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { SWEEP_LIMIT, TERMINAL_RETENTION_MS, runSessionSweep } = require('../../cloudfunctions/session-security-sweeper/index.js')

describe('shared application-session timer sweep', () => {
  it('expires active sessions before purging retained terminal records', async () => {
    const calls = []
    const sweeper = {
      sweepExpired: vi.fn(async (input) => {
        calls.push(['expired', input])
        return { scanned: 3, expired: 2 }
      }),
      sweepTerminal: vi.fn(async (input) => {
        calls.push(['terminal', input])
        return { scanned: 1, removed: 1 }
      }),
    }

    await expect(runSessionSweep(sweeper, 2_000_000_000_000)).resolves.toEqual({
      ok: true,
      expired: { scanned: 3, expired: 2 },
      terminal: { scanned: 1, removed: 1 },
    })
    expect(calls).toEqual([
      ['expired', { now: 2_000_000_000_000, limit: SWEEP_LIMIT }],
      ['terminal', { now: 2_000_000_000_000, retentionMs: TERMINAL_RETENTION_MS, limit: SWEEP_LIMIT }],
    ])
  })
})
