import { describe, expect, it, vi } from 'vitest'

import { runSyntheticChat } from '../../cloudfunctions/ai-gateway/lib/synthetic-relay.js'

describe('ai-gateway synthetic metered relay', () => {
  it('reserves budget, starts exactly one model call, settles billing, and returns success', async () => {
    const deps = fakeDeps()

    await expect(runSyntheticChat(input(), deps)).resolves.toEqual({
      ok: true,
      content: 'safe result',
      balance: 1,
      deduped: false,
    })
    expect(deps.generate).toHaveBeenCalledTimes(1)
    expect(deps.deduct).toHaveBeenCalledWith(expect.objectContaining({
      reservationId: 'reservation_01',
      syntheticLeaseId: 'lease_01',
      syntheticScopeId: 'wish',
    }))
    expect(deps.settle).toHaveBeenCalledTimes(1)
  })

  it('does not call the model when lease or daily budget cannot be reserved', async () => {
    const deps = fakeDeps({ reserve: { kind: 'budget_exceeded' } })

    await expect(runSyntheticChat(input(), deps)).resolves.toMatchObject({
      ok: false,
      code: 'synthetic_budget_exceeded',
    })
    expect(deps.generate).not.toHaveBeenCalled()
    expect(deps.deduct).not.toHaveBeenCalled()
  })

  it('does not call the model for a concurrent or replayed reservation', async () => {
    const deps = fakeDeps({ start: { kind: 'in_progress' } })

    await expect(runSyntheticChat(input(), deps)).resolves.toMatchObject({
      ok: false,
      code: 'synthetic_in_progress',
    })
    expect(deps.generate).not.toHaveBeenCalled()
  })

  it('releases reserved coin after a definite model failure but keeps the started count', async () => {
    const deps = fakeDeps({ generateError: new Error('model failed') })

    await expect(runSyntheticChat(input(), deps)).resolves.toMatchObject({ ok: false, code: 'ai_failed' })
    expect(deps.failGeneration).toHaveBeenCalledWith(expect.objectContaining({ reservationId: 'reservation_01' }))
    expect(deps.deduct).not.toHaveBeenCalled()
  })

  it('discards a generated result when release wins before success is committed', async () => {
    const deps = fakeDeps({ succeed: { kind: 'lease_inactive' } })

    await expect(runSyntheticChat(input(), deps)).resolves.toMatchObject({
      ok: false,
      code: 'lease_inactive',
    })
    expect(deps.generate).toHaveBeenCalledTimes(1)
    expect(deps.deduct).not.toHaveBeenCalled()
  })

  it('never returns success when trusted wallet settlement fails', async () => {
    const deps = fakeDeps({ deductError: new Error('wallet unavailable') })

    await expect(runSyntheticChat(input(), deps)).resolves.toMatchObject({
      ok: false,
      code: 'synthetic_reconcile_required',
    })
    expect(deps.markReconcile).toHaveBeenCalledTimes(1)
    expect(deps.settle).not.toHaveBeenCalled()
  })
})

function input() {
  return {
    appId: 'everything-generator',
    bizId: 'wish:req-01:audit',
    cost: 1,
    identity: { _id: 'identity_01', uid: 'test_uid_01' },
    leaseCapability: 'capability.jwt',
    messages: [{ role: 'user', content: 'private wish text' }],
    uid: 'test_uid_01',
  }
}

function fakeDeps(options = {}) {
  return {
    authorize: vi.fn(async () => ({
      action: 'wish:audit',
      billingAppId: 'everything-generator',
      claims: { leaseId: 'lease_01' },
      scopeId: 'wish',
    })),
    reserve: vi.fn(async () => options.reserve || { kind: 'reserved', reservationId: 'reservation_01' }),
    start: vi.fn(async () => options.start || { kind: 'started' }),
    generate: vi.fn(async () => {
      if (options.generateError)
        throw options.generateError
      return 'safe result'
    }),
    failGeneration: vi.fn(async () => {}),
    succeedGeneration: vi.fn(async () => options.succeed || { kind: 'succeeded' }),
    deduct: vi.fn(async () => {
      if (options.deductError)
        throw options.deductError
      return { balance: 1, deduped: false, transactionId: 'tx_01' }
    }),
    settle: vi.fn(async () => {}),
    markReconcile: vi.fn(async () => {}),
  }
}
