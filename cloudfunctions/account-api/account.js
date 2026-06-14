/**
 * 账户全貌快照（云币余额 + 会员状态）。
 *
 * 登录态入口（getAccount）与内部服务入口（getAccountForUser）共用本模块，
 * 保证两条链路返回结构一致（AccountSnapshot）。db 依赖注入，便于单元测试。
 *
 * 仅依赖 SYNCED lib（wallet / membership / orders），不重复实现读取逻辑。
 */

'use strict'

const { isMembershipActive } = require('./lib/membership')
const { MEMBERSHIPS_COLLECTION } = require('./lib/orders')
const { getWallet } = require('./lib/wallet')

/**
 * 读取用户会员记录（不存在返回 null）
 *
 * @param {object} db
 * @param {string} userId
 * @returns {Promise<object|null>} 会员记录，不存在返回 null
 */
async function readMembership(db, userId) {
  const { data } = await db
    .collection(MEMBERSHIPS_COLLECTION)
    .where({ userId })
    .limit(1)
    .get()
  return Array.isArray(data) && data.length > 0 ? data[0] : null
}

/**
 * 账户全貌（余额 + 会员），只读、不产生流水。
 *
 * @param {object} db
 * @param {string} userId
 * @param {number} [now]
 * @returns {Promise<{ coin: number, membership: { isActive: boolean, level: string|null, expireAt: number|null } }>} 账户全貌快照
 */
async function getAccountSnapshot(db, userId, now = Date.now()) {
  const [wallet, membership] = await Promise.all([
    getWallet(db, userId),
    readMembership(db, userId),
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

module.exports = {
  readMembership,
  getAccountSnapshot,
}
