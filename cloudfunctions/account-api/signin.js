/**
 * 每日签到领云币（account-api 本地模块，非同步 lib）。
 *
 * 规则：免费用户每日 1 云币，会员每日 2 云币。按东八区自然日切日。
 * 幂等：refId = `signin:<uid>:<东八区 YYYY-MM-DD>`，复用 creditCoin 的
 * (userId, refId, 'gift') 去重 —— 同一自然日重复签到只入账一次。
 *
 * 连续签到（周循环日历 + 7 天里程碑）：
 *   - user_signin_stats 记录 currentStreak / longestStreak / lastSignDateKey / totalDays（派生态，
 *     真值仍是 coin_transactions 流水，可重算自愈）。
 *   - 仅当日「真正入账」的胜者推进 streak（按东八区昨日判断连续 / 断签）。
 *   - 连续每满 7 天额外发里程碑奖励（免费 +10 / 会员 +20），幂等键
 *     `signin-milestone:<uid>:<达成日>`，确保只发一次；与日常币自动一并到账。
 *
 * 注意：必须由登录态入口（index.js）传入真实 uid；匿名 uid 已在入口拦截，
 * 不会落到这里（参见 cloudbase-anon-payment 历史坑）。
 */

'use strict'

const { readMembership } = require('./account')
const { cstDateKey } = require('./datetime')
const { isMembershipActive } = require('./lib/membership')
const { creditCoin, findTxByRef, getBalance } = require('./lib/wallet')

/** 签到流水归属应用（平台级） */
const SIGNIN_APP_ID = 'yunle'
/** 免费用户每日签到云币 */
const SIGNIN_REWARD_FREE = 1
/** 会员每日签到云币 */
const SIGNIN_REWARD_MEMBER = 2
/** 连续签到一个周期的天数（周循环日历） */
const SIGNIN_WEEK_LEN = 7
/** 每满一个周期（连续 7 天）额外里程碑奖励：免费 / 会员 */
const SIGNIN_MILESTONE_FREE = 10
const SIGNIN_MILESTONE_MEMBER = 20
/** 连续签到统计集合（派生态，真值仍是 coin_transactions 流水） */
const SIGNIN_STATS_COLLECTION = 'user_signin_stats'
/** stats 并发更新最大重试次数 */
const SIGNIN_STATS_MAX_RETRY = 5
/** 一天的毫秒数（用于「昨天」判断） */
const DAY_MS = 86_400_000

/** 构造签到幂等 refId（日常币） */
function signinRefId(userId, dateKey) {
  return `signin:${userId}:${dateKey}`
}

/** 构造里程碑奖励幂等 refId（按达成日，确保只发一次） */
function milestoneRefId(userId, dateKey) {
  return `signin-milestone:${userId}:${dateKey}`
}

/** 本周期内进度（1..SIGNIN_WEEK_LEN）；streak < 1 返回 0 */
function weekProgressOf(streak) {
  if (!streak || streak < 1)
    return 0
  return ((streak - 1) % SIGNIN_WEEK_LEN) + 1
}

/** 是否「满一个周期」的里程碑日（连续天数为 7 的整数倍） */
function isMilestoneDay(streak) {
  return streak > 0 && streak % SIGNIN_WEEK_LEN === 0
}

/** 把 stats 投影成对前端友好的连续签到视图（raw：调用方已确保今日在连续段内） */
function streakView(stats) {
  const currentStreak = stats?.currentStreak ?? 0
  return {
    currentStreak,
    longestStreak: stats?.longestStreak ?? 0,
    weekProgress: weekProgressOf(currentStreak),
  }
}

/** 连续签到完整视图（含周期长度与里程碑额度），供 signIn 各分支统一返回 */
function fullView(stats, isMember) {
  return {
    ...streakView(stats),
    weekLen: SIGNIN_WEEK_LEN,
    milestoneReward: isMember ? SIGNIN_MILESTONE_MEMBER : SIGNIN_MILESTONE_FREE,
  }
}

/** 读取连续签到统计（不存在返回 null） */
async function readSignInStats(db, userId) {
  const { data } = await db
    .collection(SIGNIN_STATS_COLLECTION)
    .where({ userId })
    .limit(1)
    .get()
  return Array.isArray(data) && data.length > 0 ? data[0] : null
}

/**
 * 推进连续签到统计（仅由当日「真正入账」的胜者调用一次）。
 *
 * 按东八区自然日判断：lastSignDateKey == 昨天 → 连续 +1，否则（断签 / 首签）重置为 1。
 * 沿用 wallet.js 的 read-modify-write + version 乐观锁；首签建档撞唯一索引则回退走 update。
 *
 * @param {object} db
 * @param {object} input
 * @param {string} input.userId
 * @param {string} input.dateKey 今日东八区 YYYY-MM-DD
 * @param {number} input.now
 * @returns {Promise<{ currentStreak: number, longestStreak: number, totalDays: number }>} 推进后的连续签到统计
 */
async function advanceStreak(db, { userId, dateKey, now }) {
  const yesterday = cstDateKey(now - DAY_MS)
  let lastError = null
  for (let attempt = 0; attempt < SIGNIN_STATS_MAX_RETRY; attempt++) {
    const stats = await readSignInStats(db, userId)

    if (!stats) {
      // 首签建档；并发撞唯一索引则回到循环走 update 分支
      try {
        await db.collection(SIGNIN_STATS_COLLECTION).add({
          userId,
          currentStreak: 1,
          longestStreak: 1,
          lastSignDateKey: dateKey,
          totalDays: 1,
          version: 1,
          createdAt: now,
          updatedAt: now,
        })
        return { currentStreak: 1, longestStreak: 1, totalDays: 1 }
      }
      catch (err) {
        lastError = err
        continue
      }
    }

    // 二次保险：当日去重已在 signIn 上游挡住，这里再挡一次
    if (stats.lastSignDateKey === dateKey)
      return { currentStreak: stats.currentStreak, longestStreak: stats.longestStreak, totalDays: stats.totalDays }

    const currentStreak = stats.lastSignDateKey === yesterday ? (stats.currentStreak || 0) + 1 : 1
    const longestStreak = Math.max(stats.longestStreak || 0, currentStreak)
    const totalDays = (stats.totalDays || 0) + 1

    const result = await db
      .collection(SIGNIN_STATS_COLLECTION)
      .where({ userId, version: stats.version })
      .update({
        currentStreak,
        longestStreak,
        lastSignDateKey: dateKey,
        totalDays,
        version: stats.version + 1,
        updatedAt: now,
      })
    const updated = result?.updated ?? result?.modifiedCount ?? 0
    if (updated > 0)
      return { currentStreak, longestStreak, totalDays }
    // 被并发改写，重读重试
  }
  throw lastError || new Error(`advanceStreak: 用户 ${userId} 并发重试 ${SIGNIN_STATS_MAX_RETRY} 次仍未成功`)
}

/**
 * 读取「今日签到态」（只读、不产生流水），供前端渲染按钮 / 日历状态。
 *
 * @param {object} db
 * @param {object} input
 * @param {string} input.userId
 * @param {number} input.now
 * @returns {Promise<{ signedToday: boolean, reward: number, dateKey: string, isMember: boolean,
 *   currentStreak: number, longestStreak: number, weekProgress: number, weekLen: number, milestoneReward: number }>}
 *   今日签到态 + 连续签到视图
 */
async function getSignInStatus(db, { userId, now }) {
  if (!userId)
    throw new Error('getSignInStatus: 缺少 userId')
  const dateKey = cstDateKey(now)
  const [existing, membership, stats] = await Promise.all([
    findTxByRef(db, { userId, refId: signinRefId(userId, dateKey), type: 'gift' }),
    readMembership(db, userId),
    readSignInStats(db, userId),
  ])
  const isMember = isMembershipActive(membership?.expireAt, now)

  // 断签判定：最近签到既非今天也非昨天 → 连续已断，展示归零（今签将从 1 起算）
  const yesterday = cstDateKey(now - DAY_MS)
  const lastKey = stats?.lastSignDateKey
  const alive = lastKey === dateKey || lastKey === yesterday
  const currentStreak = alive ? (stats?.currentStreak ?? 0) : 0

  return {
    signedToday: !!existing,
    // 已签到则回报实际入账额（避免当日升级会员后金额错位）
    reward: existing ? Math.abs(existing.amount) : (isMember ? SIGNIN_REWARD_MEMBER : SIGNIN_REWARD_FREE),
    dateKey,
    isMember,
    currentStreak,
    longestStreak: stats?.longestStreak ?? 0,
    weekProgress: weekProgressOf(currentStreak),
    weekLen: SIGNIN_WEEK_LEN,
    milestoneReward: isMember ? SIGNIN_MILESTONE_MEMBER : SIGNIN_MILESTONE_FREE,
  }
}

/**
 * 执行每日签到（幂等）。当日已签到则返回 alreadySigned=true、不重复入账。
 *
 * 返回连续签到视图（currentStreak / longestStreak / weekProgress / weekLen / milestoneReward），
 * 并在满一个周期时携带 milestone={ streak, bonus }（仅本次真正发放里程碑时非空）。
 *
 * @param {object} db
 * @param {object} input
 * @param {string} input.userId
 * @param {number} input.now
 * @returns {Promise<object>} 签到结果 + 连续签到视图（命中里程碑时携带 milestone={ streak, bonus }）
 */
async function signIn(db, { userId, now }) {
  if (!userId)
    throw new Error('signIn: 缺少 userId')
  const dateKey = cstDateKey(now)
  const refId = signinRefId(userId, dateKey)

  // 预判：今日已签到 → 返回实际入账额 + 当前连续态（只读，不重复入账）。
  const existing = await findTxByRef(db, { userId, refId, type: 'gift' })
  if (existing) {
    // 读真实钱包余额：里程碑日当天日常 tx 的 balanceAfter 已被里程碑入账刷新，不能直接用其快照
    const [stats, balance] = await Promise.all([
      readSignInStats(db, userId),
      getBalance(db, userId),
    ])
    const isMember = !!existing.meta?.isMember
    return {
      balance,
      reward: Math.abs(existing.amount),
      alreadySigned: true,
      dateKey,
      isMember,
      ...fullView(stats, isMember),
      milestone: null,
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

  // 并发败者：本次未真正入账，连续态交由胜者维护，这里读真实余额只读返回。
  if (deduped) {
    const [stats, currentBalance] = await Promise.all([
      readSignInStats(db, userId),
      getBalance(db, userId),
    ])
    return { balance: currentBalance, reward, alreadySigned: true, dateKey, isMember, ...fullView(stats, isMember), milestone: null }
  }

  // 胜者：推进连续签到。
  const stats = await advanceStreak(db, { userId, dateKey, now })

  // 满一个周期（连续 7 的倍数）→ 额外里程碑奖励（按达成日幂等，与日常币一并到账）。
  let finalBalance = balance
  let milestone = null
  if (isMilestoneDay(stats.currentStreak)) {
    const bonus = isMember ? SIGNIN_MILESTONE_MEMBER : SIGNIN_MILESTONE_FREE
    const credited = await creditCoin(db, {
      userId,
      appId: SIGNIN_APP_ID,
      amount: bonus,
      type: 'gift',
      refId: milestoneRefId(userId, dateKey),
      meta: { signinMilestone: true, dateKey, streak: stats.currentStreak, isMember },
      now,
    })
    finalBalance = credited.balance
    if (!credited.deduped)
      milestone = { streak: stats.currentStreak, bonus }
  }

  return {
    balance: finalBalance,
    reward,
    alreadySigned: false,
    dateKey,
    isMember,
    ...fullView(stats, isMember),
    milestone,
  }
}

module.exports = {
  SIGNIN_APP_ID,
  SIGNIN_REWARD_FREE,
  SIGNIN_REWARD_MEMBER,
  SIGNIN_WEEK_LEN,
  SIGNIN_MILESTONE_FREE,
  SIGNIN_MILESTONE_MEMBER,
  SIGNIN_STATS_COLLECTION,
  signinRefId,
  milestoneRefId,
  weekProgressOf,
  isMilestoneDay,
  readSignInStats,
  getSignInStatus,
  signIn,
}
