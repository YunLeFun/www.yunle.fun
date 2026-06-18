/**
 * 每日签到领云币（account-api 本地模块，非同步 lib）。
 *
 * 规则：免费用户每日 1 云币，会员每日 2 云币。按东八区自然日切日。
 * 幂等：refId = `signin:<uid>:<东八区 YYYY-MM-DD>`，复用 creditCoin 的
 * (userId, refId, 'gift') 去重 —— 同一自然日重复签到只入账一次。
 *
 * 注意：必须由登录态入口（index.js）传入真实 uid；匿名 uid 已在入口拦截，
 * 不会落到这里（参见 cloudbase-anon-payment 历史坑）。
 */

'use strict'

const { readMembership } = require('./account')
const { cstDateKey } = require('./datetime')
const { isMembershipActive } = require('./lib/membership')
const { creditCoin, findTxByRef } = require('./lib/wallet')

/** 签到流水归属应用（平台级） */
const SIGNIN_APP_ID = 'yunle'
/** 免费用户每日签到云币 */
const SIGNIN_REWARD_FREE = 1
/** 会员每日签到云币 */
const SIGNIN_REWARD_MEMBER = 2

/** 构造签到幂等 refId */
function signinRefId(userId, dateKey) {
  return `signin:${userId}:${dateKey}`
}

/**
 * 读取「今日签到态」（只读、不产生流水），供前端渲染按钮状态。
 *
 * @param {object} db
 * @param {object} input
 * @param {string} input.userId
 * @param {number} input.now
 * @returns {Promise<{ signedToday: boolean, reward: number, dateKey: string, isMember: boolean }>}
 */
async function getSignInStatus(db, { userId, now }) {
  if (!userId)
    throw new Error('getSignInStatus: 缺少 userId')
  const dateKey = cstDateKey(now)
  const [existing, membership] = await Promise.all([
    findTxByRef(db, { userId, refId: signinRefId(userId, dateKey), type: 'gift' }),
    readMembership(db, userId),
  ])
  const isMember = isMembershipActive(membership?.expireAt, now)
  return {
    signedToday: !!existing,
    // 已签到则回报实际入账额（避免当日升级会员后金额错位）
    reward: existing ? Math.abs(existing.amount) : (isMember ? SIGNIN_REWARD_MEMBER : SIGNIN_REWARD_FREE),
    dateKey,
    isMember,
  }
}

/**
 * 执行每日签到（幂等）。当日已签到则返回 alreadySigned=true、不重复入账。
 *
 * @param {object} db
 * @param {object} input
 * @param {string} input.userId
 * @param {number} input.now
 * @returns {Promise<{ balance: number, reward: number, alreadySigned: boolean, dateKey: string, isMember?: boolean }>}
 */
async function signIn(db, { userId, now }) {
  if (!userId)
    throw new Error('signIn: 缺少 userId')
  const dateKey = cstDateKey(now)
  const refId = signinRefId(userId, dateKey)

  // 预判：今日已签到 → 直接返回实际入账额。creditCoin 内部仍按 refId 去重兜底并发。
  const existing = await findTxByRef(db, { userId, refId, type: 'gift' })
  if (existing) {
    return {
      balance: existing.balanceAfter,
      reward: Math.abs(existing.amount),
      alreadySigned: true,
      dateKey,
    }
  }

  const membership = await readMembership(db, userId)
  const isMember = isMembershipActive(membership?.expireAt, now)
  const reward = isMember ? SIGNIN_REWARD_MEMBER : SIGNIN_REWARD_FREE

  const { balance, deduped } = await creditCoin(db, {
    userId,
    appId: SIGNIN_APP_ID,
    amount: reward,
    type: 'gift',
    refId,
    meta: { signin: true, dateKey, isMember },
    now,
  })

  return { balance, reward, alreadySigned: !!deduped, dateKey, isMember }
}

module.exports = {
  SIGNIN_APP_ID,
  SIGNIN_REWARD_FREE,
  SIGNIN_REWARD_MEMBER,
  signinRefId,
  getSignInStatus,
  signIn,
}
