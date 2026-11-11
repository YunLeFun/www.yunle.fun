/** Authenticated client contract; verified Apple payloads only. Sync before packaging. */
'use strict'

const { assertGrantablePayload } = require('./appstore')
const { grantIapTransaction, handleIapRefund } = require('./iap')
const { assertIapAccount, assertIapEnvironment } = require('./iap-sandbox')
const { assertPurchaseOwner } = require('./iap-settlement')
const { findOrderByOutTradeNo } = require('./orders')
const { getIapApplication, getIapProduct } = require('./plans')

function getIapCapabilities(bundleId, ledgerEnvironment) {
  if (!['Production', 'Sandbox'].includes(ledgerEnvironment))
    throw new Error('IAP 账本环境非法')
  const application = getIapApplication(bundleId)
  return {
    application: application.appId,
    bundleId,
    ledgerEnvironment,
    // Auto-renewals stay unavailable until their server lifecycle is implemented.
    products: Object.entries(application.products).map(([id, product]) => ({
      id,
      kind: product.orderType === 'membership' ? 'nonRenewing' : 'consumable',
    })),
  }
}

async function reconcileIapTransaction(db, { userId, transactionId, bundleId, payload, environment, now }) {
  if (payload.transactionId !== transactionId)
    throw new Error('Apple 返回交易与请求不一致')
  if (payload.bundleId !== bundleId)
    throw new Error('Apple 交易应用与服务配置不一致')
  assertIapEnvironment(db, payload, environment)
  const application = getIapApplication(bundleId)
  let result
  if (application.appId === 'cook' && payload.revocationDate) {
    const accountToken = assertPurchaseOwner(userId, payload)
    if (!accountToken)
      throw new Error('Cook 交易必须包含购买账号标记')
    assertIapAccount(db, userId, accountToken)
    getIapProduct(payload.productId, bundleId)
    if (payload.type !== 'Non-Renewing Subscription')
      throw new Error('Cook 单次会员交易类型不匹配')
    const outTradeNo = `iap_${transactionId}`
    const order = await findOrderByOutTradeNo(db, outTradeNo)
    // An absent/pending order may race settlement. Retain the Apple queue until
    // a durable paid/refunded order can be reconciled; never claim a new owner.
    if (!order || order.userId !== userId || order.appId !== 'cook'
      || order.meta?.productId !== payload.productId || !['paid', 'refunded'].includes(order.status)) {
      throw new Error('撤销交易尚无可核对的原订单')
    }
    await handleIapRefund(db, { payload, now })
    result = { outTradeNo, revoked: true, granted: false }
  }
  else {
    assertGrantablePayload(payload, { bundleId })
    result = await grantIapTransaction(db, { userId, payload, environment, now })
  }
  // Existing applications keep their public response shape.
  return application.appId === 'cook'
    ? { ...result, application: 'cook', bundleId, ledgerEnvironment: environment }
    : result
}

module.exports = { getIapCapabilities, reconcileIapTransaction }
