/**
 * 云函数 account-api —— 平台账户中心（云币钱包 + 跨应用会员）。
 *
 * 路由 action：
 *   - getAccount        一次拿到账户全貌（云币余额 + 会员状态），需登录
 *   - deductCoin        按次扣云币（需登录，幂等键 bizId）
 *   - deductCoinForUser 内部服务按指定 userId 扣云币（需 ACCOUNT_API_INTERNAL_TOKEN）
 *   - adminAdjustCoin   管理员人工调账（增/减，需 ACCOUNT_API_INTERNAL_TOKEN）
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
  handleAdminAdjustCoin,
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

/**
 * 匿名 / 占位身份集合。CloudBase 在「仅用公开 accessKey、未真正登录」时
 * 会以匿名身份调用云函数，getUserInfo().uid 可能为空或 'anon'。
 * 这类身份绝不能用于扣费 / 读取余额，否则会命中共享占位账户。
 */
const ANON_UIDS = new Set(['', 'anon'])

/** 当前调用者 uid（CloudBase Auth）；匿名 / 占位身份一律视为未登录返回 '' */
function getCallerUid() {
  try {
    const auth = app.auth()
    const info = auth.getUserInfo()
    const uid = info?.uid || ''
    return ANON_UIDS.has(uid) ? '' : uid
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
      case 'adminAdjustCoin':
        return await handleAdminAdjustCoin(db, event)
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
  handleAdminAdjustCoin,
  handleDeductCoinForUser,
}
