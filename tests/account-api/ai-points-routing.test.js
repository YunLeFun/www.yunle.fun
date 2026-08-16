import { describe, expect, it } from 'vitest'

import {
  AI_POINT_INTERNAL_ACTIONS,
  dispatchAiPointInternalAction,
  isAiPointInternalAction,
} from '../../cloudfunctions/account-api/ai-point-routing.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = Date.parse('2026-08-14T09:00:00+08:00')
const TOKEN = 'ai-runtime-account-api-token'

describe('account-api ai point routing', () => {
  it('recognizes only the approved private ledger actions', () => {
    expect([...AI_POINT_INTERNAL_ACTIONS].sort()).toEqual([
      'adjustAiPointsForUser',
      'getAiPointAccountForUser',
      'grantAiPointsForUser',
      'listAiPointTransactionsForUser',
      'refundAiPointsForTask',
      'releaseAiPointsForTask',
      'reserveAiPointsForTask',
      'settleAiPointsForTask',
    ])
    expect(isAiPointInternalAction('grantAiPointsForUser')).toBe(true)
    expect(isAiPointInternalAction('deductCoin')).toBe(false)
  })

  it('dispatches through token-protected handlers without trusting event time', async () => {
    const db = makeFakeDb({})
    await dispatchAiPointInternalAction(db, {
      action: 'grantAiPointsForUser',
      serviceToken: TOKEN,
      userId: 'user_fixture_001',
      appId: 'advjs-studio',
      scope: 'studio-managed-ai',
      amountMicroPoints: 100_000,
      idempotencyKey: 'beta-grant:user_fixture_001:v1',
      actor: 'admin',
      operator: 'owner_fixture',
      reason: 'ADV.JS beta',
      now: 1,
    }, { expectedToken: TOKEN, now: NOW })

    await expect(dispatchAiPointInternalAction(db, {
      action: 'getAiPointAccountForUser',
      serviceToken: TOKEN,
      userId: 'user_fixture_001',
    }, { expectedToken: TOKEN })).resolves.toMatchObject({
      availableMicroPoints: 100_000,
      createdAt: NOW,
    })
    await expect(dispatchAiPointInternalAction(db, {
      action: 'unknownAiPointAction',
      serviceToken: TOKEN,
    }, { expectedToken: TOKEN })).rejects.toThrow(/未知 AI 点数 action/)
  })
})
