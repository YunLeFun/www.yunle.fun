import { describe, expect, it, vi } from 'vitest'
import { AccountApiClient } from '../adapters/account-api.js'

describe('dedicated account-api client', () => {
  it('uses only its dedicated service token for reserve, settle and release actions', async () => {
    const invoke = vi.fn(async (input: Record<string, unknown>) => {
      if (input.action === 'getAiPointAccountForUser') {
        return {
          activeTask: { taskId: 'task_fixture_001' },
          availableMicroPoints: 80,
          reservedMicroPoints: 20,
          lifetimeChargedMicroPoints: 5,
        }
      }
      return { ok: true }
    })
    const client = new AccountApiClient({
      activeTaskTtlMs: 15 * 60_000,
      appId: 'advjs-studio',
      clock: { now: () => 1_723_599_000_000 },
      invoke,
      scope: 'studio-managed-ai',
      serviceToken: 'dedicated-ai-runtime-token-fixture-001',
    })

    await client.reserve({
      idempotencyKey: 'reserve_fixture_001',
      microPoints: 20,
      taskId: 'task_fixture_001',
      uid: 'uid_fixture_001',
    })
    await client.settle({
      chargedMicroPoints: 5,
      idempotencyKey: 'settle_fixture_001',
      taskId: 'task_fixture_001',
      uid: 'uid_fixture_001',
    })
    await client.release({
      idempotencyKey: 'release_fixture_001',
      taskId: 'task_fixture_001',
      uid: 'uid_fixture_001',
    })

    expect(invoke.mock.calls.map(([input]) => input)).toMatchObject([
      {
        action: 'reserveAiPointsForTask',
        activeTaskExpiresAt: 1_723_599_900_000,
        amountMicroPoints: 20,
        serviceToken: 'dedicated-ai-runtime-token-fixture-001',
      },
      {
        action: 'settleAiPointsForTask',
        chargedMicroPoints: 5,
        serviceToken: 'dedicated-ai-runtime-token-fixture-001',
      },
      {
        action: 'releaseAiPointsForTask',
        reason: 'runtime_terminal_release',
        serviceToken: 'dedicated-ai-runtime-token-fixture-001',
      },
    ])
    await expect(client.getAccount('uid_fixture_001')).resolves.toEqual({
      activeTask: 'task_fixture_001',
      availableMicroPoints: 80,
      chargedMicroPoints: 5,
      reservedMicroPoints: 20,
      uid: 'uid_fixture_001',
    })
  })

  it('maps opaque transaction cursors to server-owned pagination', async () => {
    const invoke = vi.fn(async () => ({
      items: [{ type: 'settle', chargedMicroPoints: 5 }],
      nextSkip: 40,
    }))
    const client = new AccountApiClient({
      activeTaskTtlMs: 60_000,
      appId: 'advjs-studio',
      clock: { now: () => 100 },
      invoke,
      scope: 'studio-managed-ai',
      serviceToken: 'dedicated-ai-runtime-token-fixture-001',
    })

    await expect(client.listTransactions('uid_fixture_001', 'offset:20')).resolves.toEqual({
      items: [{ type: 'settle', chargedMicroPoints: 5 }],
      nextCursor: 'offset:40',
    })
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({
      action: 'listAiPointTransactionsForUser',
      limit: 20,
      skip: 20,
    }))
  })

  it('fails closed when the dedicated credential is missing', () => {
    expect(() => new AccountApiClient({
      activeTaskTtlMs: 60_000,
      appId: 'advjs-studio',
      clock: { now: () => 100 },
      invoke: vi.fn(),
      scope: 'studio-managed-ai',
      serviceToken: '',
    })).toThrowError(/dedicated account-api credential/i)
  })
})
