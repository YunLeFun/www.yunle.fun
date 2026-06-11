/**
 * 云币钱包账本（依赖注入式纯函数，便于单元测试）。
 *
 * 跨应用共享余额：一个用户一条 user_wallet 记录（与 appId 无关），
 * 每笔流水写入 coin_transactions 并携带 appId，便于分应用对账。
 *
 * 并发安全沿用 orders.js 的策略：read-modify-write + 乐观锁（version 比对）重试，
 * 且**不使用** db 的 _.inc() 等命令对象——在 JS 里算出新值后整字段写回，
 * 这样既能被 vitest 的 fake db 直接测试，也避免命令对象在不同运行时的兼容差异。
 *
 * SYNCED FILE: 修改此文件后，请执行 `pnpm sync:wxpay-lib`。
 */

'use strict'

const WALLET_COLLECTION = 'user_wallet'
const COIN_TX_COLLECTION = 'coin_transactions'

/** 钱包变更在并发冲突时的最大重试次数 */
const WALLET_MAX_RETRY = 5

/**
 * 读取用户钱包（不存在返回 null）
 *
 * @param {object} db
 * @param {string} userId
 * @returns {Promise<object|null>}
 */
async function getWallet(db, userId) {
  const { data } = await db
    .collection(WALLET_COLLECTION)
    .where({ userId })
    .limit(1)
    .get()
  return Array.isArray(data) && data.length > 0 ? data[0] : null
}

/**
 * 读取用户云币余额（无钱包视为 0）
 *
 * @param {object} db
 * @param {string} userId
 * @returns {Promise<number>}
 */
async function getBalance(db, userId) {
  const wallet = await getWallet(db, userId)
  return wallet ? wallet.balance : 0
}

/**
 * 按 (userId, refId, type) 查重，用于幂等：同一业务引用只入/扣一次。
 *
 * @param {object} db
 * @param {object} q
 * @param {string} q.userId
 * @param {string} q.refId
 * @param {string} q.type
 * @returns {Promise<object|null>}
 */
async function findTxByRef(db, { userId, refId, type }) {
  if (!refId)
    return null
  const { data } = await db
    .collection(COIN_TX_COLLECTION)
    .where({ userId, refId, type })
    .limit(1)
    .get()
  return Array.isArray(data) && data.length > 0 ? data[0] : null
}

/**
 * 写一条云币流水
 * @private
 */
async function writeCoinTx(db, { userId, appId, type, amount, balanceAfter, refId, meta, now }) {
  await db.collection(COIN_TX_COLLECTION).add({
    userId,
    appId: appId || '',
    type,
    amount,
    balanceAfter,
    refId: refId || '',
    meta: meta || {},
    createdAt: now,
  })
}

/**
 * 云币入账（充值 / 退款补偿 / 活动赠送）。
 *
 * 幂等：传入 refId 时，若已存在同 (userId, refId, type) 流水则直接返回，不重复入账。
 * 充值场景下，上游 markOrderPaid 的条件更新已保证单订单只入账一次，refId 去重是二次保险。
 *
 * @param {object} db
 * @param {object} input
 * @param {string} input.userId
 * @param {string} input.appId
 * @param {number} input.amount 正整数云币数
 * @param {string} [input.type] 'recharge' | 'refund' | 'gift'，默认 'recharge'
 * @param {string} [input.refId] 业务引用（充值=outTradeNo），用于幂等
 * @param {object} [input.meta]
 * @param {number} input.now
 * @returns {Promise<{ balance: number, deduped?: boolean }>}
 */
async function creditCoin(db, { userId, appId, amount, type = 'recharge', refId, meta, now }) {
  if (!userId)
    throw new Error('creditCoin: 缺少 userId')
  if (!Number.isInteger(amount) || amount <= 0)
    throw new Error(`creditCoin: amount 必须为正整数，收到 ${amount}`)

  const dup = await findTxByRef(db, { userId, refId, type })
  if (dup)
    return { balance: dup.balanceAfter, deduped: true }

  let lastError = null
  for (let attempt = 0; attempt < WALLET_MAX_RETRY; attempt++) {
    const wallet = await getWallet(db, userId)

    if (!wallet) {
      // 首次：尝试创建钱包；若并发 insert 撞唯一索引，回到循环走 update 分支
      try {
        await db.collection(WALLET_COLLECTION).add({
          userId,
          balance: amount,
          version: 1,
          createdAt: now,
          updatedAt: now,
        })
        await writeCoinTx(db, { userId, appId, type, amount, balanceAfter: amount, refId, meta, now })
        return { balance: amount }
      }
      catch (err) {
        lastError = err
        continue
      }
    }

    const newBalance = wallet.balance + amount
    // 乐观锁：仅当 version 未变时更新
    const result = await db
      .collection(WALLET_COLLECTION)
      .where({ userId, version: wallet.version })
      .update({ balance: newBalance, version: wallet.version + 1, updatedAt: now })
    const updated = result?.updated ?? result?.modifiedCount ?? 0
    if (updated > 0) {
      await writeCoinTx(db, { userId, appId, type, amount, balanceAfter: newBalance, refId, meta, now })
      return { balance: newBalance }
    }
    // 被并发改写，重读重试
  }

  throw lastError || new Error(`creditCoin: 用户 ${userId} 并发重试 ${WALLET_MAX_RETRY} 次仍未成功`)
}

/**
 * 云币扣减（按次/按量消费）。
 *
 * 幂等：传入 bizId 时，重复调用只扣一次（按 (userId, bizId, 'consume') 查重）。
 * 余额不足直接抛错，不产生流水。
 *
 * @param {object} db
 * @param {object} input
 * @param {string} input.userId
 * @param {string} input.appId
 * @param {number} input.amount 正整数云币数
 * @param {string} [input.bizId] 业务幂等键
 * @param {object} [input.meta]
 * @param {number} input.now
 * @returns {Promise<{ balance: number, deduped?: boolean }>}
 * @throws 余额不足 / 并发冲突
 */
async function deductCoin(db, { userId, appId, amount, bizId, meta, now }) {
  if (!userId)
    throw new Error('deductCoin: 缺少 userId')
  if (!Number.isInteger(amount) || amount <= 0)
    throw new Error(`deductCoin: amount 必须为正整数，收到 ${amount}`)

  if (bizId) {
    const dup = await findTxByRef(db, { userId, refId: bizId, type: 'consume' })
    if (dup)
      return { balance: dup.balanceAfter, deduped: true }
  }

  for (let attempt = 0; attempt < WALLET_MAX_RETRY; attempt++) {
    const wallet = await getWallet(db, userId)
    if (!wallet || wallet.balance < amount)
      throw new Error('云币余额不足')

    const newBalance = wallet.balance - amount
    const result = await db
      .collection(WALLET_COLLECTION)
      .where({ userId, version: wallet.version })
      .update({ balance: newBalance, version: wallet.version + 1, updatedAt: now })
    const updated = result?.updated ?? result?.modifiedCount ?? 0
    if (updated > 0) {
      await writeCoinTx(db, {
        userId,
        appId,
        type: 'consume',
        amount: -amount,
        balanceAfter: newBalance,
        refId: bizId,
        meta,
        now,
      })
      return { balance: newBalance }
    }
    // 被并发改写，重读重试
  }

  throw new Error('云币扣费并发冲突，请重试')
}

/**
 * 云币追回（支付渠道退款后收回已入账的云币）。
 *
 * 与 deductCoin 的区别：余额不足不抛错，扣到零封顶（差额即平台资损，由调用方记日志）。
 * 幂等：按 (userId, refId, 'refund') 查重；**即使追回 0 也写占位流水**——
 * 否则通知重试间隙用户再充值会被误扣。
 *
 * @param {object} db
 * @param {object} input
 * @param {string} input.userId
 * @param {string} input.appId
 * @param {number} input.amount 应追回的正整数云币数
 * @param {string} input.refId 业务引用（退款=订单 outTradeNo），幂等必需
 * @param {object} [input.meta]
 * @param {number} input.now
 * @returns {Promise<{ balance: number, clawed: number, deduped?: boolean }>}
 */
async function clawbackCoin(db, { userId, appId, amount, refId, meta, now }) {
  if (!userId)
    throw new Error('clawbackCoin: 缺少 userId')
  if (!Number.isInteger(amount) || amount <= 0)
    throw new Error(`clawbackCoin: amount 必须为正整数，收到 ${amount}`)
  if (!refId)
    throw new Error('clawbackCoin: 缺少 refId（幂等必需）')

  const dup = await findTxByRef(db, { userId, refId, type: 'refund' })
  if (dup)
    return { balance: dup.balanceAfter, clawed: Math.abs(dup.amount), deduped: true }

  for (let attempt = 0; attempt < WALLET_MAX_RETRY; attempt++) {
    const wallet = await getWallet(db, userId)

    if (!wallet) {
      // 无钱包视为余额 0：只写占位流水挡住后续重试
      await writeCoinTx(db, {
        userId,
        appId,
        type: 'refund',
        amount: 0,
        balanceAfter: 0,
        refId,
        meta: { ...meta, requested: amount, clawed: 0 },
        now,
      })
      return { balance: 0, clawed: 0 }
    }

    const clawed = Math.min(wallet.balance, amount)
    const newBalance = wallet.balance - clawed
    const result = await db
      .collection(WALLET_COLLECTION)
      .where({ userId, version: wallet.version })
      .update({ balance: newBalance, version: wallet.version + 1, updatedAt: now })
    const updated = result?.updated ?? result?.modifiedCount ?? 0
    if (updated > 0) {
      await writeCoinTx(db, {
        userId,
        appId,
        type: 'refund',
        amount: -clawed,
        balanceAfter: newBalance,
        refId,
        meta: { ...meta, requested: amount, clawed },
        now,
      })
      return { balance: newBalance, clawed }
    }
    // 被并发改写，重读重试
  }

  throw new Error(`clawbackCoin: 用户 ${userId} 并发重试 ${WALLET_MAX_RETRY} 次仍未成功`)
}

module.exports = {
  WALLET_COLLECTION,
  COIN_TX_COLLECTION,
  WALLET_MAX_RETRY,
  getWallet,
  getBalance,
  findTxByRef,
  creditCoin,
  deductCoin,
  clawbackCoin,
}
