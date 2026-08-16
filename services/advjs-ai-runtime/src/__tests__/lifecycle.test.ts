import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuntimeBackgroundLoop } from '../production/lifecycle.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('production background lifecycle', () => {
  it('drains queued work, runs the sweeper and stops scheduling cleanly', async () => {
    vi.useFakeTimers()
    const runOnce = vi.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false)
    const sweep = vi.fn().mockResolvedValue({})
    const loop = new RuntimeBackgroundLoop({ runOnce }, { sweep }, {
      sweepIntervalMs: 1_000,
      workerBatchSize: 10,
      workerPollMs: 100,
    })

    loop.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(runOnce).toHaveBeenCalledTimes(2)
    expect(sweep).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(100)
    expect(runOnce).toHaveBeenCalledTimes(3)

    loop.stop()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(runOnce).toHaveBeenCalledTimes(3)
    expect(sweep).toHaveBeenCalledTimes(1)
  })

  it('does not overlap a worker cycle while the previous one is pending', async () => {
    vi.useFakeTimers()
    let release!: (value: boolean) => void
    const runOnce = vi.fn(() => new Promise<boolean>(resolve => release = resolve))
    const loop = new RuntimeBackgroundLoop({ runOnce }, { sweep: async () => ({}) }, {
      sweepIntervalMs: 1_000,
      workerBatchSize: 10,
      workerPollMs: 100,
    })

    loop.start()
    await vi.advanceTimersByTimeAsync(500)
    expect(runOnce).toHaveBeenCalledTimes(1)
    release(false)
    await vi.advanceTimersByTimeAsync(0)
    loop.stop()
  })
})
