import { describe, expect, it } from 'vitest'

import {
  applyAiPointV2Migration,
  buildAiPointV2MigrationPlan,
} from '../../cloudfunctions/account-api/ai-point-migration-v2.js'
import {
  AI_POINT_ACCOUNTS_COLLECTION,
  AI_POINT_RESERVATIONS_COLLECTION,
  AI_POINT_TRANSACTIONS_COLLECTION,
} from '../../cloudfunctions/account-api/ai-points.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = Date.parse('2026-08-20T11:00:00+08:00')

function legacyDb() {
  return makeFakeDb({
    [AI_POINT_ACCOUNTS_COLLECTION]: [{
      _id: 'legacy-account-id',
      userId: 'legacy_user',
      access: 'beta',
      availableMicroPoints: 70_000,
      reservedMicroPoints: 30_000,
      lifetimeGrantedMicroPoints: 100_000,
      lifetimeChargedMicroPoints: 0,
      activeTask: {
        taskId: 'legacy_task',
        appId: 'advjs-studio',
        scope: 'studio-managed-ai',
        reservedMicroPoints: 30_000,
        expiresAt: NOW + 10 * 60 * 1000,
      },
      daily: {
        dateKey: '2026-08-20',
        acceptedTasks: 1,
        reservedMicroPoints: 30_000,
        chargedMicroPoints: 0,
      },
      version: 2,
      createdAt: NOW - 1_000,
      updatedAt: NOW,
    }],
    [AI_POINT_TRANSACTIONS_COLLECTION]: [{
      _id: 'immutable-legacy-transaction',
      userId: 'legacy_user',
      type: 'beta_grant',
      availableDelta: 100_000,
      reservedDelta: 0,
      createdAt: NOW - 1_000,
    }],
  })
}

describe('aI point ledger v2 one-time migration', () => {
  it('dry-runs without writes and reports conserved account totals', async () => {
    const db = legacyDb()
    const before = structuredClone(db._store)

    const plan = await buildAiPointV2MigrationPlan(db, { now: NOW })

    expect(plan).toEqual({
      schemaVersion: 2,
      scannedAccounts: 1,
      migrationAccounts: 1,
      activeReservations: 1,
      totals: {
        availableMicroPoints: 70_000,
        reservedMicroPoints: 30_000,
        lifetimeGrantedMicroPoints: 100_000,
        lifetimeChargedMicroPoints: 0,
      },
    })
    expect(db._store).toEqual(before)
  })

  it('applies once, preserves immutable transactions and replays without changes', async () => {
    const db = legacyDb()
    const transactionsBefore = structuredClone(db._store[AI_POINT_TRANSACTIONS_COLLECTION])

    const first = await applyAiPointV2Migration(db, { now: NOW })
    const afterFirst = structuredClone(db._store)
    const replay = await applyAiPointV2Migration(db, { now: NOW + 1 })

    expect(first).toMatchObject({ migratedAccounts: 1, createdReservations: 1 })
    expect(replay).toMatchObject({ migratedAccounts: 0, createdReservations: 0 })
    expect(db._store).toEqual(afterFirst)
    expect(db._store[AI_POINT_ACCOUNTS_COLLECTION]).toEqual([
      expect.objectContaining({
        _id: 'legacy-account-id',
        schemaVersion: 2,
        userId: 'legacy_user',
        availableMicroPoints: 70_000,
        reservedMicroPoints: 30_000,
        activeReservationCount: 1,
        daily: {
          dateKey: '2026-08-20',
          reservedMicroPoints: 30_000,
          chargedMicroPoints: 0,
        },
      }),
    ])
    expect(db._store[AI_POINT_ACCOUNTS_COLLECTION][0]).not.toHaveProperty('access')
    expect(db._store[AI_POINT_ACCOUNTS_COLLECTION][0]).not.toHaveProperty('activeTask')
    expect(db._store[AI_POINT_RESERVATIONS_COLLECTION]).toEqual([
      expect.objectContaining({
        userId: 'legacy_user',
        taskId: 'legacy_task',
        status: 'active',
        reservedMicroPoints: 30_000,
      }),
    ])
    expect(db._store[AI_POINT_TRANSACTIONS_COLLECTION]).toEqual(transactionsBefore)
  })
})
