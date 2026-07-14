/**
 * 云币钱包账本（依赖注入式纯函数，便于单元测试）。
 *
 * 跨应用共享余额：一个用户一条 user_wallet 记录（与 appId 无关），
 * 每笔流水写入 coin_transactions 并携带 appId，便于分应用对账。
 *
 * 余额与对应流水必须在同一 CloudBase 事务内提交，避免并发重试时只改余额、
 * 流水因唯一索引失败而产生资损。有业务引用时，流水使用稳定文档 ID，
 * 事务冲突重试后可在事务内直接判定幂等。
 *
 * SYNCED FILE: 修改此文件后，请执行 `pnpm sync:wxpay-lib`。
 */

'use strict'

const crypto = require('node:crypto')

const WALLET_COLLECTION = 'user_wallet'
const COIN_TX_COLLECTION = 'coin_transactions'

/** 兼容旧模块导出；实际事务冲突由 CloudBase SDK 自动重试。 */
const WALLET_MAX_RETRY = 5

function stableDocId(namespace, ...parts) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify([namespace, ...parts]))
    .digest('hex')
    .slice(0, 24)
}

function randomDocId() {
  return crypto.randomBytes(12).toString('hex')
}

function walletDocId(userId, wallet) {
  return wallet && typeof wallet._id === 'string' && wallet._id
    ? wallet._id
    : stableDocId('user_wallet', userId)
}

function coinTxDocId({ userId, type, refId }) {
  return refId
    ? stableDocId('coin_transaction', userId, type, refId)
    : randomDocId()
}

function transactionDoc(result) {
  if (!result)
    return null
  if (Array.isArray(result.data))
    return result.data[0] || null
  return result.data && typeof result.data === 'object' ? result.data : null
}

function assertDatabaseResult(result) {
  if (!result || !result.code)
    return
  const error = new Error(typeof result.message === 'string' ? result.message : 'database transaction failed')
  error.code = typeof result.code === 'string' ? result.code : 'DATABASE_ERROR'
  throw error
}

async function readTransactionDoc(ref) {
  const result = await ref.get()
  assertDatabaseResult(result)
  return transactionDoc(result)
}

async function setTransactionDoc(ref, data) {
  const result = await ref.set(data)
  assertDatabaseResult(result)
}

async function updateTransactionDoc(ref, data) {
  const result = await ref.update(data)
  assertDatabaseResult(result)
  const updated = result?.updated ?? result?.modifiedCount
  if (updated !== undefined && Number(updated) <= 0)
    throw new Error('云币钱包事务更新未生效')
}

function walletBalance(wallet) {
  if (!wallet)
    return 0
  if (!Number.isInteger(wallet.balance) || wallet.balance < 0)
    throw new Error('云币钱包余额数据异常')
  return wallet.balance
}

function walletVersion(wallet) {
  return Number.isInteger(wallet && wallet.version) && wallet.version >= 0 ? wallet.version : 0
}

function assertWalletOwner(wallet, userId) {
  if (wallet && wallet.userId !== userId)
    throw new Error('云币钱包文档归属异常')
}

function assertCoinTxMatch(transaction, { userId, type, refId }) {
  if (
    transaction
    && (
      transaction.userId !== userId
      || transaction.type !== type
      || transaction.refId !== refId
    )
  ) {
    throw new Error('云币流水幂等键冲突')
  }
}

function coinTxData({ userId, appId, type, amount, balanceAfter, refId, meta, now }) {
  return {
    userId,
    appId: appId || '',
    type,
    amount,
    balanceAfter,
    refId: refId || '',
    meta: meta || {},
    createdAt: now,
  }
}

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

  const knownWallet = await getWallet(db, userId)
  const walletId = walletDocId(userId, knownWallet)
  const transactionId = coinTxDocId({ userId, type, refId })
  let outcome

  try {
    await db.runTransaction(async (transaction) => {
      const txRef = transaction.collection(COIN_TX_COLLECTION).doc(transactionId)
      if (refId) {
        const existing = await readTransactionDoc(txRef)
        assertCoinTxMatch(existing, { userId, type, refId })
        if (existing) {
          outcome = { balance: existing.balanceAfter, deduped: true }
          return outcome
        }
      }

      const walletRef = transaction.collection(WALLET_COLLECTION).doc(walletId)
      const current = await readTransactionDoc(walletRef)
      assertWalletOwner(current, userId)
      const newBalance = walletBalance(current) + amount
      if (current) {
        await updateTransactionDoc(walletRef, {
          balance: newBalance,
          version: walletVersion(current) + 1,
          updatedAt: now,
        })
      }
      else {
        await setTransactionDoc(walletRef, {
          userId,
          balance: newBalance,
          version: 1,
          createdAt: now,
          updatedAt: now,
        })
      }
      await setTransactionDoc(txRef, coinTxData({
        userId,
        appId,
        type,
        amount,
        balanceAfter: newBalance,
        refId,
        meta,
        now,
      }))
      outcome = { balance: newBalance }
      return outcome
    })
  }
  catch (error) {
    const duplicate = refId ? await findTxByRef(db, { userId, refId, type }) : null
    if (duplicate)
      return { balance: duplicate.balanceAfter, deduped: true }
    throw error
  }

  return outcome
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

  const knownWallet = await getWallet(db, userId)
  const walletId = walletDocId(userId, knownWallet)
  const transactionId = coinTxDocId({ userId, type: 'consume', refId: bizId })
  let outcome

  try {
    await db.runTransaction(async (transaction) => {
      const txRef = transaction.collection(COIN_TX_COLLECTION).doc(transactionId)
      if (bizId) {
        const existing = await readTransactionDoc(txRef)
        assertCoinTxMatch(existing, { userId, type: 'consume', refId: bizId })
        if (existing) {
          outcome = { balance: existing.balanceAfter, deduped: true }
          return outcome
        }
      }

      const walletRef = transaction.collection(WALLET_COLLECTION).doc(walletId)
      const current = await readTransactionDoc(walletRef)
      assertWalletOwner(current, userId)
      const currentBalance = walletBalance(current)
      if (!current || currentBalance < amount)
        throw new Error('云币余额不足')

      const newBalance = currentBalance - amount
      await updateTransactionDoc(walletRef, {
        balance: newBalance,
        version: walletVersion(current) + 1,
        updatedAt: now,
      })
      await setTransactionDoc(txRef, coinTxData({
        userId,
        appId,
        type: 'consume',
        amount: -amount,
        balanceAfter: newBalance,
        refId: bizId,
        meta,
        now,
      }))
      outcome = { balance: newBalance }
      return outcome
    })
  }
  catch (error) {
    const duplicate = bizId
      ? await findTxByRef(db, { userId, refId: bizId, type: 'consume' })
      : null
    if (duplicate)
      return { balance: duplicate.balanceAfter, deduped: true }
    throw error
  }

  return outcome
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

  const knownWallet = await getWallet(db, userId)
  const walletId = walletDocId(userId, knownWallet)
  const transactionId = coinTxDocId({ userId, type: 'refund', refId })
  let outcome

  try {
    await db.runTransaction(async (transaction) => {
      const txRef = transaction.collection(COIN_TX_COLLECTION).doc(transactionId)
      const existing = await readTransactionDoc(txRef)
      assertCoinTxMatch(existing, { userId, type: 'refund', refId })
      if (existing) {
        outcome = {
          balance: existing.balanceAfter,
          clawed: Math.abs(existing.amount),
          deduped: true,
        }
        return outcome
      }

      const walletRef = transaction.collection(WALLET_COLLECTION).doc(walletId)
      const current = await readTransactionDoc(walletRef)
      assertWalletOwner(current, userId)
      const currentBalance = walletBalance(current)
      const clawed = Math.min(currentBalance, amount)
      const newBalance = currentBalance - clawed

      if (current) {
        await updateTransactionDoc(walletRef, {
          balance: newBalance,
          version: walletVersion(current) + 1,
          updatedAt: now,
        })
      }
      await setTransactionDoc(txRef, coinTxData({
        userId,
        appId,
        type: 'refund',
        amount: clawed === 0 ? 0 : -clawed,
        balanceAfter: newBalance,
        refId,
        meta: { ...meta, requested: amount, clawed },
        now,
      }))
      outcome = { balance: newBalance, clawed }
      return outcome
    })
  }
  catch (error) {
    const duplicate = await findTxByRef(db, { userId, refId, type: 'refund' })
    if (duplicate) {
      return {
        balance: duplicate.balanceAfter,
        clawed: Math.abs(duplicate.amount),
        deduped: true,
      }
    }
    throw error
  }

  return outcome
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
