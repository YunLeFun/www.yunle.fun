import process from 'node:process'
import { beforeEach, describe, expect, it } from 'vitest'

import { ORDERS_COLLECTION } from '../../cloudfunctions/wxpay-order/lib/orders.js'
import {
  assertSyntheticOrderAllowed,
  classifySyntheticOrderAccount,
  createSyntheticOrder,
} from '../../cloudfunctions/wxpay-order/lib/synthetic-order.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const IDENTITY = {
  _id: 'fixed-1',
  uid: 'fixed-user',
  synthetic: true,
  accountKind: 'fixed',
  environment: 'production',
  status: 'ready',
}

describe('wxpay fixed test-account orders', () => {
  beforeEach(() => {
    process.env.YUNLEFUN_TEST_ACCOUNT_ENVIRONMENT = 'production'
  })

  it('creates only a synthetic order and carries no external-payment state', async () => {
    const db = makeFakeDb({ test_identities: [IDENTITY] })
    const classification = await classifySyntheticOrderAccount(db, IDENTITY.uid)
    assertSyntheticOrderAllowed(classification)

    const result = await createSyntheticOrder(db, {
      amount: 1800,
      identity: classification.identity,
      now: 1_700_000_000_000,
      orderFields: {
        appId: 'yunle',
        orderType: 'membership',
        planId: 'basic',
        level: 'basic',
        billingCycle: 'month',
      },
      outTradeNo: 'YLFSYNTHETIC001',
      requestedPayType: 'native',
      userId: IDENTITY.uid,
    })

    expect(result).toEqual({
      outTradeNo: 'YLFSYNTHETIC001',
      payType: 'native',
      status: 'synthetic',
      synthetic: true,
    })
    expect(db._store[ORDERS_COLLECTION][0]).toMatchObject({
      status: 'synthetic',
      payType: 'synthetic',
      requestedPayType: 'native',
      synthetic: true,
      externalPayment: false,
      syntheticIdentityId: 'fixed-1',
      syntheticEnvironment: 'production',
    })
    expect(db._store[ORDERS_COLLECTION][0]).not.toHaveProperty('transactionId')
    expect(db._store[ORDERS_COLLECTION][0]).not.toHaveProperty('grantedAt')
  })

  it('rejects legacy, disabled, and malformed synthetic identities', async () => {
    for (const patch of [
      { accountKind: undefined },
      { status: 'disabled' },
      { environment: 'unknown' },
    ]) {
      expect(() => assertSyntheticOrderAllowed({
        synthetic: true,
        identity: { ...IDENTITY, ...patch },
      })).toThrow(/测试身份/)
    }
    expect(() => assertSyntheticOrderAllowed({ synthetic: true, identity: IDENTITY }))
      .not
      .toThrow()
    process.env.YUNLEFUN_TEST_ACCOUNT_ENVIRONMENT = 'test'
    expect(() => assertSyntheticOrderAllowed({ synthetic: true, identity: IDENTITY }))
      .toThrow(/测试身份/)
  })

  it('fails closed when identity classification is unavailable', async () => {
    const db = {
      collection: () => ({
        where: () => ({
          limit: () => ({ get: async () => { throw new Error('down') } }),
        }),
      }),
    }
    await expect(classifySyntheticOrderAccount(db, 'user-1')).rejects.toMatchObject({
      code: 'synthetic_classification_unavailable',
      httpStatus: 503,
    })
  })
})
