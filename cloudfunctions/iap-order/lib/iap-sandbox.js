/** Fixed Sandbox ledger boundary. Authority: wxpay-order/lib; sync before packaging. */
'use strict'

const { purchaseAccountToken } = require('./iap-settlement')

const COLLECTIONS = Object.freeze({
  orders: 'ios_sandbox_orders',
  user_memberships: 'ios_sandbox_user_memberships',
  user_wallet: 'ios_sandbox_user_wallet',
  coin_transactions: 'ios_sandbox_coin_transactions',
  coin_reservations: 'ios_sandbox_coin_reservations',
})

// The boundary is associated with the actual adapter, never an event field or
// writable property such as db.environment. Only this module can create it.
const policies = new WeakMap()

function sandboxError(message) {
  const error = new Error(message)
  error.code = 'IAP_SANDBOX_FORBIDDEN'
  return error
}

function parseSandboxUsers(raw) {
  let users
  try {
    users = JSON.parse(raw)
  }
  catch {
    throw sandboxError('Sandbox 测试账号白名单未配置')
  }
  if (!Array.isArray(users) || users.length < 1 || users.length > 20
    || users.some(uid => typeof uid !== 'string' || !uid || uid.length > 128
      || uid !== uid.trim() || uid === 'anon' || uid === '*')
    || new Set(users).size !== users.length) {
    throw sandboxError('Sandbox 测试账号白名单非法')
  }
  return users
}

function createSandboxIapDatabase(db, users) {
  // Validate even internal callers; copy the array so policy cannot change later.
  const allowedUsers = new Set(parseSandboxUsers(JSON.stringify(users)))
  function collection(target, name) {
    if (!Object.hasOwn(COLLECTIONS, name))
      throw sandboxError('Sandbox 不允许访问该集合')
    return target.collection(COLLECTIONS[name])
  }
  const scoped = Object.freeze({
    collection: name => collection(db, name),
    runTransaction: callback => db.runTransaction(transaction => callback(Object.freeze({
      collection: name => collection(transaction, name),
    }))),
  })
  policies.set(scoped, allowedUsers)
  return scoped
}

function assertIapEnvironment(db, payload, environment = payload?.environment) {
  if (!['Production', 'Sandbox'].includes(environment) || payload?.environment !== environment)
    throw new Error('Apple 交易环境缺失或不一致')
  const expected = policies.has(db) ? 'Sandbox' : 'Production'
  if (environment !== expected) {
    const error = new Error(expected === 'Production'
      ? 'Sandbox 交易不能修改正式钱包或会员权益'
      : 'Production 交易不能修改 Sandbox 钱包或会员权益')
    error.code = 'IAP_ENVIRONMENT_UNSUPPORTED'
    throw error
  }
}

function assertSandboxUser(db, uid) {
  const users = policies.get(db)
  if (!users || !users.has(uid))
    throw sandboxError('当前账号不允许使用 Sandbox 账本')
}

function assertIapAccount(db, uid, accountToken) {
  if (!policies.has(db))
    return // Production preserves the legacy first-claim contract.
  assertSandboxUser(db, uid)
  if (typeof accountToken !== 'string' || accountToken.toLowerCase() !== purchaseAccountToken(uid))
    throw sandboxError('Sandbox 交易必须包含匹配的账号标记')
}

module.exports = {
  SANDBOX_COLLECTIONS: COLLECTIONS,
  parseSandboxUsers,
  createSandboxIapDatabase,
  assertIapEnvironment,
  assertSandboxUser,
  assertIapAccount,
}
