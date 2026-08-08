/** Fixed test-account order isolation. */

'use strict'

const process = require('node:process')

const { ORDERS_COLLECTION } = require('./orders')

class SyntheticOrderError extends Error {
  constructor(code, message, httpStatus = 403) {
    super(message)
    this.name = 'SyntheticOrderError'
    this.code = code
    this.httpStatus = httpStatus
  }
}

function isReadyFixedSyntheticIdentity(
  identity,
  expectedEnvironment = process.env.YUNLEFUN_TEST_ACCOUNT_ENVIRONMENT,
) {
  return identity?.synthetic === true
    && identity.accountKind === 'fixed'
    && identity.status === 'ready'
    && (expectedEnvironment === 'test' || expectedEnvironment === 'production')
    && identity.environment === expectedEnvironment
}

async function classifySyntheticOrderAccount(db, uid) {
  try {
    const result = await db.collection('test_identities').where({ uid }).limit(2).get()
    if (!result || !Array.isArray(result.data))
      throw new Error('invalid classification result')
    if (result.data.length === 0)
      return { synthetic: false }
    if (result.data.length !== 1
      || result.data[0]?.uid !== uid
      || result.data[0]?.synthetic !== true
      || typeof result.data[0]?._id !== 'string') {
      throw new Error('ambiguous synthetic classification')
    }
    return { synthetic: true, identity: result.data[0] }
  }
  catch {
    throw new SyntheticOrderError(
      'synthetic_classification_unavailable',
      '测试身份分类服务暂时不可用。',
      503,
    )
  }
}

function assertSyntheticOrderAllowed(classification) {
  if (classification.synthetic && !isReadyFixedSyntheticIdentity(classification.identity)) {
    throw new SyntheticOrderError(
      'synthetic_order_forbidden',
      '当前测试身份不允许创建订单。',
    )
  }
}

async function createSyntheticOrder(db, input) {
  const { identity } = input
  if (!isReadyFixedSyntheticIdentity(identity))
    throw new SyntheticOrderError('synthetic_order_forbidden', '当前测试身份不允许创建订单。')

  await db.collection(ORDERS_COLLECTION).add({
    userId: input.userId,
    ...input.orderFields,
    amount: input.amount,
    payType: 'synthetic',
    requestedPayType: input.requestedPayType,
    status: 'synthetic',
    outTradeNo: input.outTradeNo,
    synthetic: true,
    externalPayment: false,
    syntheticIdentityId: identity._id,
    syntheticEnvironment: identity.environment,
    createdAt: input.now,
    updatedAt: input.now,
  })

  return {
    outTradeNo: input.outTradeNo,
    payType: input.requestedPayType,
    status: 'synthetic',
    synthetic: true,
  }
}

module.exports = {
  SyntheticOrderError,
  assertSyntheticOrderAllowed,
  classifySyntheticOrderAccount,
  createSyntheticOrder,
  isReadyFixedSyntheticIdentity,
}
