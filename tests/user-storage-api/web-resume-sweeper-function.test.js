import { describe, expect, it, vi } from 'vitest'

import { runWebResumeStorageSweep, SWEEP_LIMIT } from '../../cloudfunctions/web-resume-storage-sweeper/index.js'

describe('web Resume storage timer', () => {
  it('invokes only the private bounded sweep action', async () => {
    const callFunction = vi.fn(async () => ({
      result: { deferred: 0, errors: 0, ok: true, purged: 2, scanned: 2 },
    }))

    await expect(runWebResumeStorageSweep({ callFunction }, 'x'.repeat(32))).resolves.toMatchObject({ purged: 2 })
    expect(callFunction).toHaveBeenCalledWith({
      name: 'user-storage-api',
      data: {
        action: 'sweepWebResumeTrash',
        limit: SWEEP_LIMIT,
        serviceToken: 'x'.repeat(32),
      },
    })
  })
})
