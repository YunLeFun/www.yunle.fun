import process from 'node:process'
import { beforeEach, describe, expect, it } from 'vitest'

import { COIN_TX_COLLECTION, WALLET_COLLECTION } from '../../cloudfunctions/account-api/lib/wallet.js'
import {
  handleFundPachinkoRoundForUser,
  handleGetPachinkoBalanceForUser,
  handleSettlePachinkoRoundForUser,
  PACHINKO_SETTLEMENT_COLLECTION,
} from '../../cloudfunctions/account-api/pachinko.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = 1_700_000_000_000
const TOKEN = 'p'.repeat(48)
const ROUND_ID = `pch_${'a'.repeat(32)}`
const SEED_COMMITMENT = 'b'.repeat(64)
const TARGETS = [
  { pocketId: 'left-x2', multiplier: 2 },
  { pocketId: 'left-x3', multiplier: 3 },
  { pocketId: 'left-x5', multiplier: 5 },
]

function base(extra = {}) {
  return {
    serviceToken: TOKEN,
    userId: 'u1',
    roundId: ROUND_ID,
    wager: 20,
    rulesetId: 'cloud-coin-machine-v3',
    rulesetVersion: 3,
    seedCommitment: SEED_COMMITMENT,
    ...extra,
  }
}

function settlement(extra = {}) {
  return {
    ...base(),
    kind: 'payout',
    targets: TARGETS,
    pocketId: 'left-x5',
    multiplier: 5,
    ...extra,
  }
}

describe('account-api Pachinko round settlement', () => {
  beforeEach(() => {
    process.env.YUNLEFUN_TEST_ACCOUNT_ENVIRONMENT = 'production'
  })

  it('requires a strong purpose-specific token', async () => {
    const db = makeFakeDb({})
    await expect(handleFundPachinkoRoundForUser(db, base({ serviceToken: 'wrong' }), {
      expectedToken: TOKEN,
      now: NOW,
    })).rejects.toThrow(/鉴权失败/)
    await expect(handleFundPachinkoRoundForUser(db, base(), {
      expectedToken: 'short',
      now: NOW,
    })).rejects.toThrow(/鉴权未配置/)
  })

  it('reads only the Pachinko player coin balance', async () => {
    const db = makeFakeDb({
      [WALLET_COLLECTION]: [{ _id: 'w', userId: 'u1', balance: 120, version: 1 }],
    })
    await expect(handleGetPachinkoBalanceForUser(db, {
      serviceToken: TOKEN,
      userId: 'u1',
    }, { expectedToken: TOKEN })).resolves.toEqual({ balance: 120 })
  })

  it('funds a round once with a value-bound bet reference', async () => {
    const db = makeFakeDb({
      [WALLET_COLLECTION]: [{ _id: 'w', userId: 'u1', balance: 120, version: 1 }],
    })
    const first = await handleFundPachinkoRoundForUser(db, base(), {
      expectedToken: TOKEN,
      now: NOW,
    })
    const replay = await handleFundPachinkoRoundForUser(db, base(), {
      expectedToken: TOKEN,
      now: NOW + 1,
    })

    expect(first).toEqual({
      balance: 100,
      deduped: false,
      ledgerRef: `play:pachinko:${ROUND_ID}:bet`,
    })
    expect(replay).toMatchObject({ balance: 100, deduped: true })
    expect(db._store[COIN_TX_COLLECTION]).toHaveLength(1)
    expect(db._store[COIN_TX_COLLECTION][0]).toMatchObject({
      appId: 'play',
      amount: -20,
      type: 'consume',
      meta: {
        coinOperation: 'pachinko_bet',
        roundId: ROUND_ID,
        wager: 20,
      },
    })

    await expect(handleFundPachinkoRoundForUser(db, base({ wager: 21 }), {
      expectedToken: TOKEN,
      now: NOW + 2,
    })).rejects.toThrow(/幂等参数冲突/)
    expect(db._store[WALLET_COLLECTION][0].balance).toBe(100)
  })

  it('rejects invalid wagers, rulesets, targets, and awards', async () => {
    const db = makeFakeDb({})
    await expect(handleFundPachinkoRoundForUser(db, base({ wager: 101 }), {
      expectedToken: TOKEN,
      now: NOW,
    })).rejects.toThrow(/1 至 100/)
    await expect(handleFundPachinkoRoundForUser(db, base({ rulesetVersion: 2 }), {
      expectedToken: TOKEN,
      now: NOW,
    })).rejects.toThrow(/规则版本/)
    await expect(handleSettlePachinkoRoundForUser(db, settlement({ multiplier: 10 }), {
      expectedToken: TOKEN,
      now: NOW,
    })).rejects.toThrow(/命中结果/)
  })

  it('pays a winning round once and rejects a mismatched replay', async () => {
    const db = makeFakeDb({
      [WALLET_COLLECTION]: [{ _id: 'w', userId: 'u1', balance: 120, version: 1 }],
    })
    await handleFundPachinkoRoundForUser(db, base(), { expectedToken: TOKEN, now: NOW - 1 })
    const first = await handleSettlePachinkoRoundForUser(db, settlement(), {
      expectedToken: TOKEN,
      now: NOW,
    })
    const replay = await handleSettlePachinkoRoundForUser(db, settlement(), {
      expectedToken: TOKEN,
      now: NOW + 1,
    })

    expect(first).toEqual({
      balance: 200,
      deduped: false,
      ledgerRef: `play:pachinko:${ROUND_ID}:payout`,
    })
    expect(replay).toMatchObject({ balance: 200, deduped: true })
    expect(db._store[COIN_TX_COLLECTION]).toHaveLength(2)
    expect(db._store[PACHINKO_SETTLEMENT_COLLECTION]).toHaveLength(1)
    expect(db._store[PACHINKO_SETTLEMENT_COLLECTION][0]).toMatchObject({
      kind: 'payout',
      payout: 100,
      status: 'confirmed',
    })

    await expect(handleSettlePachinkoRoundForUser(db, settlement({
      targets: [
        { pocketId: 'far-left-x1', multiplier: 1 },
        { pocketId: 'left-x3', multiplier: 3 },
        { pocketId: 'left-x2', multiplier: 2 },
      ],
      pocketId: 'left-x2',
      multiplier: 2,
    }), { expectedToken: TOKEN, now: NOW + 2 })).rejects.toThrow(/结算意图/)
    expect(db._store[WALLET_COLLECTION][0].balance).toBe(200)
  })

  it('deduplicates concurrent identical settlement calls', async () => {
    const db = makeFakeDb({
      [WALLET_COLLECTION]: [{ _id: 'w', userId: 'u1', balance: 120, version: 1 }],
    })
    await handleFundPachinkoRoundForUser(db, base(), { expectedToken: TOKEN, now: NOW - 1 })
    const [left, right] = await Promise.all([
      handleSettlePachinkoRoundForUser(db, settlement(), { expectedToken: TOKEN, now: NOW }),
      handleSettlePachinkoRoundForUser(db, settlement(), { expectedToken: TOKEN, now: NOW + 1 }),
    ])

    expect([left.deduped, right.deduped].sort()).toEqual([false, true])
    expect(left.balance).toBe(200)
    expect(right.balance).toBe(200)
    expect(db._store[WALLET_COLLECTION][0].balance).toBe(200)
    expect(db._store[COIN_TX_COLLECTION]).toHaveLength(2)
  })

  it('makes payout and technical refund mutually exclusive', async () => {
    const db = makeFakeDb({
      [WALLET_COLLECTION]: [{ _id: 'w', userId: 'u1', balance: 120, version: 1 }],
    })
    await handleFundPachinkoRoundForUser(db, base(), { expectedToken: TOKEN, now: NOW - 1 })
    await handleSettlePachinkoRoundForUser(db, settlement(), {
      expectedToken: TOKEN,
      now: NOW,
    })
    await expect(handleSettlePachinkoRoundForUser(db, settlement({
      kind: 'refund',
      reason: 'simulation_unavailable',
      pocketId: undefined,
      multiplier: undefined,
    }), { expectedToken: TOKEN, now: NOW + 1 })).rejects.toThrow(/不同的结算意图/)
    expect(db._store[COIN_TX_COLLECTION]).toHaveLength(2)
  })

  it('refunds exactly the wager with a technical compensation reference', async () => {
    const db = makeFakeDb({
      [WALLET_COLLECTION]: [{ _id: 'w', userId: 'u1', balance: 120, version: 1 }],
    })
    await handleFundPachinkoRoundForUser(db, base(), { expectedToken: TOKEN, now: NOW - 1 })
    const result = await handleSettlePachinkoRoundForUser(db, settlement({
      kind: 'refund',
      reason: 'simulation_unavailable',
      pocketId: undefined,
      multiplier: undefined,
    }), { expectedToken: TOKEN, now: NOW })

    expect(result).toEqual({
      balance: 120,
      deduped: false,
      ledgerRef: `play:pachinko:${ROUND_ID}:refund`,
    })
    expect(db._store[COIN_TX_COLLECTION][1]).toMatchObject({
      amount: 20,
      type: 'refund',
      meta: {
        kind: 'refund',
        payout: 20,
        reason: 'simulation_unavailable',
      },
    })
  })

  it('refuses payout or refund when the matching funded bet is absent', async () => {
    const db = makeFakeDb({
      [WALLET_COLLECTION]: [{ _id: 'w', userId: 'u1', balance: 100, version: 1 }],
    })
    await expect(handleSettlePachinkoRoundForUser(db, settlement(), {
      expectedToken: TOKEN,
      now: NOW,
    })).rejects.toThrow(/流水确认失败/)
    expect(db._store[WALLET_COLLECTION][0].balance).toBe(100)
    expect(db._store[COIN_TX_COLLECTION] || []).toHaveLength(0)
  })

  it('preserves forced synthetic metadata for ready fixed accounts', async () => {
    const db = makeFakeDb({
      test_identities: [{
        _id: 'fixed-1',
        uid: 'fixed-user',
        synthetic: true,
        accountKind: 'fixed',
        environment: 'production',
        status: 'ready',
      }],
      [WALLET_COLLECTION]: [{ _id: 'w', userId: 'fixed-user', balance: 120, version: 1 }],
    })
    await handleFundPachinkoRoundForUser(db, base({ userId: 'fixed-user' }), {
      expectedToken: TOKEN,
      now: NOW,
    })
    expect(db._store[COIN_TX_COLLECTION][0].meta).toMatchObject({
      fixedTestAccount: true,
      synthetic: true,
      syntheticEnvironment: 'production',
      syntheticIdentityId: 'fixed-1',
      coinOperation: 'pachinko_bet',
    })
  })
})
