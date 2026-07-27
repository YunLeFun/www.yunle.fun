import Module, { createRequire } from 'node:module'
import process from 'node:process'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import {
  MEMBERSHIPS_COLLECTION,
  ORDERS_COLLECTION,
} from '../../cloudfunctions/wxpay-order/lib/orders.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const h = {
  db: null,
  queryTransaction: async () => {
    throw new Error('unexpected WeChat transaction query')
  },
  uid: 'u1',
}

const dbProxy = new Proxy({}, {
  get(_target, property) {
    const value = h.db[property]
    return typeof value === 'function' ? value.bind(h.db) : value
  },
})

const cloudbaseStub = {
  SYMBOL_CURRENT_ENV: Symbol.for('test-env'),
  init: () => ({
    auth: () => ({
      getUserInfo: () => ({ uid: h.uid }),
    }),
    callFunction: async () => ({ result: null }),
    database: () => dbProxy,
  }),
}

const wxpayClientStub = {
  queryTransactionByOutTradeNo: (...args) => h.queryTransaction(...args),
  wxpayRequest: async () => {
    throw new Error('unexpected WeChat request')
  },
}

describe('wxpay-order queryOrder', () => {
  let main

  beforeAll(() => {
    const originalLoad = Module._load
    Module._load = function (request, parent, isMain) {
      if (request === '@cloudbase/node-sdk')
        return cloudbaseStub
      if (request === './lib/wxpay-client' && parent?.filename.endsWith('/cloudfunctions/wxpay-order/index.js'))
        return wxpayClientStub
      return originalLoad.call(this, request, parent, isMain)
    }

    try {
      const require = createRequire(import.meta.url)
      const indexPath = require.resolve('../../cloudfunctions/wxpay-order/index.js')
      delete require.cache[indexPath]
      ;({ main } = require(indexPath))
    }
    finally {
      Module._load = originalLoad
    }
  })

  beforeEach(() => {
    process.env.WX_APPID = 'wx-app-id'
    process.env.WX_MCH_ID = 'wx-merchant-id'
    process.env.WX_SERIAL_NO = 'wx-serial'
    process.env.WX_PRIVATE_KEY = 'test-private-key'
    process.env.WX_NOTIFY_URL = 'https://example.com/wxpay-notify'

    h.uid = 'u1'
    h.queryTransaction = async () => {
      throw new Error('unexpected WeChat transaction query')
    }
    h.db = makeFakeDb({
      [ORDERS_COLLECTION]: [{
        _id: 'order-1',
        outTradeNo: 'YLFPAIDNOTGRANTED',
        userId: 'u1',
        orderType: 'membership',
        level: 'basic',
        billingCycle: 'month',
        status: 'paid',
        transactionId: 'wx-transaction-1',
        paidAt: 1_700_000_000_000,
      }],
      [MEMBERSHIPS_COLLECTION]: [],
    })
  })

  it('returns paid only after a concurrently confirmed membership order has granted its entitlement', async () => {
    const result = await main({
      action: 'queryOrder',
      outTradeNo: 'YLFPAIDNOTGRANTED',
    })

    expect(result.status).toBe('paid')
    expect(h.db._store[MEMBERSHIPS_COLLECTION]).toHaveLength(1)
    expect(h.db._store[MEMBERSHIPS_COLLECTION][0]).toMatchObject({
      _id: 'u1',
      lastOrderId: 'YLFPAIDNOTGRANTED',
    })
    expect(h.db._store[MEMBERSHIPS_COLLECTION][0]).not.toHaveProperty('userId')
    expect(h.db._store[ORDERS_COLLECTION][0].grantedAt).toEqual(expect.any(Number))
  })

  it('waits for entitlement when the payment callback wins the pending-to-paid race', async () => {
    const order = {
      _id: 'order-2',
      outTradeNo: 'YLFCALLBACKRACE',
      userId: 'u1',
      orderType: 'membership',
      level: 'basic',
      billingCycle: 'month',
      amount: 1800,
      status: 'pending',
    }
    h.db = makeFakeDb({
      [ORDERS_COLLECTION]: [order],
      [MEMBERSHIPS_COLLECTION]: [],
    })
    h.queryTransaction = async () => {
      Object.assign(h.db._store[ORDERS_COLLECTION][0], {
        status: 'paid',
        transactionId: 'wx-transaction-2',
        paidAt: 1_700_000_000_000,
      })
      return {
        trade_state: 'SUCCESS',
        appid: process.env.WX_APPID,
        mchid: process.env.WX_MCH_ID,
        amount: { total: order.amount },
        transaction_id: 'wx-transaction-2',
      }
    }

    const result = await main({
      action: 'queryOrder',
      outTradeNo: order.outTradeNo,
    })

    expect(result.status).toBe('paid')
    expect(h.db._store[MEMBERSHIPS_COLLECTION]).toHaveLength(1)
    expect(h.db._store[MEMBERSHIPS_COLLECTION][0].lastOrderId).toBe(order.outTradeNo)
    expect(h.db._store[ORDERS_COLLECTION][0].grantedAt).toEqual(expect.any(Number))
  })
})
