/**
 * 云函数 account-api —— 平台账户中心（云币钱包 + 跨应用会员）。
 *
 * 路由 action：
 *   - getAccount        一次拿到账户全貌（云币余额 + 会员状态），需登录
 *   - deductCoin        按次扣云币（需登录，幂等键 bizId）
 *   - deductCoinForUser 内部服务按指定 userId 扣云币（需 ACCOUNT_API_INTERNAL_TOKEN）
 *   - listTransactions  云币流水分页（需登录）
 *
 * 主入口只做"参数解析 + 鉴权 + 路由"，纯逻辑委托给 lib/（与 wxpay-order 共享同一份 lib）。
 *
 * lib/ 由 `pnpm sync:wxpay-lib` 从 functions/wxpay-order/lib 同步，禁止直接修改本目录的 lib。
 */

'use strict'

const cloudbase = require('@cloudbase/node-sdk')

const {
  assertInternalServiceToken,
  assertUserId,
  handleDeductCoinForUser,
} = require('./internal')
const { isMembershipActive } = require('./lib/membership')
const { MEMBERSHIPS_COLLECTION } = require('./lib/orders')
const { assertDeductCoinInput } = require('./lib/validation')
const {
  COIN_TX_COLLECTION,
  deductCoin,
  getWallet,
} = require('./lib/wallet')

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
const db = app.database()

/** 当前调用者 uid（CloudBase Auth） */
function getCallerUid() {
  try {
    const auth = app.auth()
    const info = auth.getUserInfo()
    return info?.uid || ''
  }
  catch {
    return ''
  }
}

/** 读取会员记录（不存在返回 null） */
async function readMembership(userId) {
  const { data } = await db
    .collection(MEMBERSHIPS_COLLECTION)
    .where({ userId })
    .limit(1)
    .get()
  return Array.isArray(data) && data.length > 0 ? data[0] : null
}

async function handleGetAccount(uid) {
  const now = Date.now()
  const [wallet, membership] = await Promise.all([
    getWallet(db, uid),
    readMembership(uid),
  ])
  return {
    coin: wallet ? wallet.balance : 0,
    membership: {
      isActive: isMembershipActive(membership?.expireAt, now),
      level: membership?.level || membership?.planId || null,
      expireAt: membership?.expireAt || null,
    },
  }
}

async function handleDeductCoin(uid, event) {
  const { appId, amount, bizId } = assertDeductCoinInput(event)
  const { balance, deduped } = await deductCoin(db, {
    userId: uid,
    appId,
    amount,
    bizId,
    meta: event.meta && typeof event.meta === 'object' ? event.meta : undefined,
    now: Date.now(),
  })
  return { balance, deduped: !!deduped }
}

async function handleListTransactions(uid, event) {
  const limit = Math.min(Math.max(Number(event.limit) || 20, 1), 100)
  // 按时间倒序分页；CloudBase 支持 orderBy + skip/limit
  const skip = Math.max(Number(event.skip) || 0, 0)
  const { data } = await db
    .collection(COIN_TX_COLLECTION)
    .where({ userId: uid })
    .orderBy('createdAt', 'desc')
    .skip(skip)
    .limit(limit)
    .get()
  const items = Array.isArray(data) ? data : []
  return {
    items,
    nextSkip: items.length === limit ? skip + limit : null,
  }
}

exports.main = async (event) => {
  const { action } = event || {}
  try {
    switch (action) {
      case 'deductCoinForUser':
        return await handleDeductCoinForUser(db, event)
      case 'getAccount':
      case 'deductCoin':
      case 'listTransactions': {
        const uid = getCallerUid()
        if (!uid)
          throw new Error('请先登录')
        if (action === 'getAccount')
          return await handleGetAccount(uid)
        if (action === 'deductCoin')
          return await handleDeductCoin(uid, event)
        return await handleListTransactions(uid, event)
      }
      default:
        throw new Error(`未知 action: ${action}`)
    }
  }
  catch (err) {
    console.error('[account-api] 处理失败:', err.message)
    throw err
  }
}

exports._private = {
  assertInternalServiceToken,
  assertUserId,
  handleDeductCoinForUser,
}
