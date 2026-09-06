/**
 * 投币打赏应用（account-api 本地模块，非同步 lib）。
 *
 * 规则（B 站式）：每次投 1 云币，每个应用每个自然日（东八区）最多投 2 次。
 * 云币不可提现：投出的币从用户钱包扣除（type:'consume'），仅计入应用「支持榜」热度，
 * 不进入任何开发者钱包（若日后给作者结算，由平台另按热度分成，不在此处）。
 *
 * 封顶与幂等合一：refId = `tip:<uid>:<appId>:<date>:<slot>`（slot ∈ 1..上限）。
 *   - 取「首个未占用的 slot」即为本次投币；slot 全部占用即达当日上限。
 *   - 同 slot 的重复请求（双击 / 重放）由 deductCoin 的 bizId 去重 → 不会重复扣。
 *
 * 计数表（去规范化，服务排行榜与「支持者」标识；以 coin_transactions 为最终真相源，
 * 计数漂移可由流水重算）：
 *   - app_tip_stats   { appId(唯一), totalCoins, tipCount, supporterCount, version }
 *   - app_supporters  { appId, userId(联合唯一), totalCoins, tipCount, firstTipAt, lastTipAt }
 */

'use strict'

const { cstDateKey } = require('./datetime')
const { deductCoin, findTxByRef } = require('./lib/wallet')

const APPS_COLLECTION = 'apps'
const APP_TIP_STATS_COLLECTION = 'app_tip_stats'
const APP_SUPPORTERS_COLLECTION = 'app_supporters'

/** Catalog IDs include app_ + UUID; payment-order IDs have a separate shorter limit. */
function assertAppId(value) {
  if (typeof value !== 'string' || !/^[\w-]{1,128}$/.test(value))
    throw new Error('无效应用标识')
  return value
}

/** 每次投币云币数 */
const TIP_AMOUNT = 1
/** 每个应用每个自然日（东八区）投币次数上限 */
const TIP_DAILY_CAP_PER_APP = 2
/** 计数表并发冲突最大重试次数 */
const STATS_MAX_RETRY = 5

/** 构造投币幂等 refId（slot 即当日第几次投该应用） */
function tipRefId(userId, appId, dateKey, slot) {
  return `tip:${userId}:${appId}:${dateKey}:${slot}`
}

/** Resolve immutable ID first; ambiguous legacy slugs must never select another owner's app. */
async function findAppBySlug(db, key) {
  const byId = await db.collection(APPS_COLLECTION).where({ _id: key }).limit(1).get()
  if (byId.data?.[0])
    return byId.data[0]
  const { data } = await db.collection(APPS_COLLECTION).where({ slug: key }).limit(2).get()
  return Array.isArray(data) && data.length === 1 ? data[0] : null
}

/**
 * upsert 支持者记录，返回是否为「该应用的首位新增支持者」（用于 supporterCount 去重累加）。
 *
 * 首投走 add（撞联合唯一索引 = 并发首投，回退到累加分支）；非首投累加个人统计。
 *
 * @returns {Promise<boolean>} 是否新增支持者
 */
async function upsertSupporter(db, { appId, userId, amount, now }) {
  const { data } = await db.collection(APP_SUPPORTERS_COLLECTION).where({ appId, userId }).limit(1).get()
  const existing = Array.isArray(data) && data.length > 0 ? data[0] : null

  if (!existing) {
    try {
      await db.collection(APP_SUPPORTERS_COLLECTION).add({
        appId,
        userId,
        totalCoins: amount,
        tipCount: 1,
        firstTipAt: now,
        lastTipAt: now,
      })
      return true
    }
    catch {
      // 并发首投撞唯一索引：回退到累加分支
    }
  }

  const cur = existing
    || (await db.collection(APP_SUPPORTERS_COLLECTION).where({ appId, userId }).limit(1).get()).data?.[0]
  await db.collection(APP_SUPPORTERS_COLLECTION).where({ appId, userId }).update({
    totalCoins: (cur?.totalCoins || 0) + amount,
    tipCount: (cur?.tipCount || 0) + 1,
    lastTipAt: now,
  })
  return false
}

/**
 * 累加应用热度计数（乐观锁 CAS，沿用 wallet 的并发策略）。
 */
async function bumpAppTipStats(db, { appId, amount, newSupporter, now }) {
  for (let attempt = 0; attempt < STATS_MAX_RETRY; attempt++) {
    const { data } = await db.collection(APP_TIP_STATS_COLLECTION).where({ appId }).limit(1).get()
    const cur = Array.isArray(data) && data.length > 0 ? data[0] : null

    if (!cur) {
      try {
        await db.collection(APP_TIP_STATS_COLLECTION).add({
          appId,
          totalCoins: amount,
          tipCount: 1,
          supporterCount: newSupporter ? 1 : 0,
          version: 1,
          createdAt: now,
          updatedAt: now,
        })
        return
      }
      catch {
        // 并发创建撞唯一索引：重读走 update 分支
        continue
      }
    }

    const result = await db
      .collection(APP_TIP_STATS_COLLECTION)
      .where({ appId, version: cur.version })
      .update({
        totalCoins: (cur.totalCoins || 0) + amount,
        tipCount: (cur.tipCount || 0) + 1,
        supporterCount: (cur.supporterCount || 0) + (newSupporter ? 1 : 0),
        version: cur.version + 1,
        updatedAt: now,
      })
    const updated = result?.updated ?? result?.modifiedCount ?? 0
    if (updated > 0)
      return
    // 被并发改写，重读重试
  }
  throw new Error('app_tip_stats 并发冲突，请重试')
}

/**
 * 投币打赏（核心）。
 *
 * @param {object} db
 * @param {object} input
 * @param {string} input.userId 投币人 uid
 * @param {string} input.appId 目标应用不可变 ID（兼容唯一的历史 slug）
 * @param {number} input.now
 * @returns {Promise<{ balance: number, tipped: number, slot: number, remainingToday: number, isNewSupporter: boolean, deduped: boolean }>}
 * @throws 应用不存在 / 给自己投币 / 当日已达上限 / 余额不足
 */
async function tip(db, { userId, appId, now }) {
  if (!userId)
    throw new Error('tip: 缺少 userId')
  const requestedAppId = assertAppId(appId)

  const app = await findAppBySlug(db, requestedAppId)
  if (!app)
    throw new Error('应用不存在')
  const cleanAppId = app.legacyTipKey || app._id || requestedAppId
  if (app.isPublic === false || (app.audience && app.audience !== 'public'))
    throw new Error('该应用未公开，暂不支持投币')
  if ([app.ownerId, app.ownerUid, app._openid].includes(userId))
    throw new Error('不能给自己的应用投币')

  const dateKey = cstDateKey(now)

  // 取首个未占用的 slot；用尽即达当日上限
  let slot = 0
  for (let s = 1; s <= TIP_DAILY_CAP_PER_APP; s++) {
    const candidate = tipRefId(userId, cleanAppId, dateKey, s)
    const used = await findTxByRef(db, { userId, refId: candidate, type: 'consume' })
    if (!used) {
      slot = s
      break
    }
  }
  if (!slot) {
    const name = app.name || cleanAppId
    throw new Error(`今日对「${name}」的投币已达上限（每日 ${TIP_DAILY_CAP_PER_APP} 次）`)
  }

  const refId = tipRefId(userId, cleanAppId, dateKey, slot)
  const { balance, deduped } = await deductCoin(db, {
    userId,
    appId: cleanAppId,
    amount: TIP_AMOUNT,
    bizId: refId,
    meta: { tip: true, dateKey, slot },
    now,
  })

  // 仅首次真实扣减时更新计数（重放命中 deduped 不重复计数）
  let isNewSupporter = false
  if (!deduped) {
    isNewSupporter = await upsertSupporter(db, { appId: cleanAppId, userId, amount: TIP_AMOUNT, now })
    await bumpAppTipStats(db, { appId: cleanAppId, amount: TIP_AMOUNT, newSupporter: isNewSupporter, now })
  }

  return {
    balance,
    tipped: TIP_AMOUNT,
    slot,
    remainingToday: Math.max(0, TIP_DAILY_CAP_PER_APP - slot),
    isNewSupporter,
    deduped: !!deduped,
  }
}

/**
 * 读取某应用的支持详情（公开；传入 uid 时附带「我是否支持过」）。
 *
 * @param {object} db
 * @param {object} input
 * @param {string} [input.userId] 调用者 uid（可空，匿名只看公开计数）
 * @param {string} input.appId
 * @returns {Promise<{ appId: string, totalCoins: number, supporterCount: number, tipCount: number, tippedByMe: boolean, myCoins: number }>}
 */
async function getAppSupport(db, { userId, appId }) {
  const requestedAppId = assertAppId(appId)
  const app = await findAppBySlug(db, requestedAppId)
  const cleanAppId = app?.legacyTipKey || app?._id || requestedAppId
  const [statsRes, mineRes, syntheticAdjustments] = await Promise.all([
    db.collection(APP_TIP_STATS_COLLECTION).where({ appId: cleanAppId }).limit(1).get(),
    userId
      ? db.collection(APP_SUPPORTERS_COLLECTION).where({ appId: cleanAppId, userId }).limit(1).get()
      : Promise.resolve({ data: [] }),
    loadSyntheticTipAdjustments(db),
  ])
  const stats = (Array.isArray(statsRes.data) && statsRes.data[0]) || null
  const mine = (Array.isArray(mineRes.data) && mineRes.data[0]) || null
  const publicStats = subtractSyntheticTipStats(stats, syntheticAdjustments.get(cleanAppId))
  return {
    appId: cleanAppId,
    ...publicStats,
    tippedByMe: !!mine,
    myCoins: mine?.totalCoins || 0,
  }
}

/**
 * 应用支持榜（公开）。
 *
 * 应用数量级很小，直接取全量在内存按 totalCoins 倒序（避免依赖 orderBy，便于单测）。
 * 如未来应用数显著增长，再切换为服务端 orderBy + 索引。
 *
 * @param {object} db
 * @param {object} [input]
 * @param {number} [input.limit] 1~100，默认 20
 * @returns {Promise<{ items: Array<{ appId: string, totalCoins: number, supporterCount: number, tipCount: number }> }>}
 */
async function getTipLeaderboard(db, { limit } = {}) {
  const n = Math.min(Math.max(Number(limit) || 20, 1), 100)
  const [{ data }, syntheticAdjustments] = await Promise.all([
    db.collection(APP_TIP_STATS_COLLECTION).limit(1000).get(),
    loadSyntheticTipAdjustments(db),
  ])
  const rows = Array.isArray(data) ? data.slice() : []
  const publicRows = rows.map(row => ({
    appId: row.appId,
    ...subtractSyntheticTipStats(row, syntheticAdjustments.get(row.appId)),
  }))
  publicRows.sort((a, b) => b.totalCoins - a.totalCoins)
  return {
    items: publicRows.slice(0, n).map(s => ({
      appId: s.appId,
      totalCoins: s.totalCoins,
      supporterCount: s.supporterCount,
      tipCount: s.tipCount,
    })),
  }
}

async function loadSyntheticTipAdjustments(db) {
  const identityResult = await db.collection('test_identities').where({ synthetic: true }).limit(1000).get()
  if (!Array.isArray(identityResult?.data) || identityResult.data.length >= 1000)
    throw new Error('测试身份分类结果无效或不完整')
  const uids = new Set()
  for (const identity of identityResult.data) {
    if (!identity || identity.synthetic !== true || typeof identity._id !== 'string'
      || typeof identity.uid !== 'string' || !/^[\w:-]{1,128}$/.test(identity.uid)
      || uids.has(identity.uid)) {
      throw new Error('测试身份分类结果无效')
    }
    uids.add(identity.uid)
  }

  const adjustments = new Map()
  const supporterKeys = new Set()
  for (const uid of uids) {
    const result = await db.collection(APP_SUPPORTERS_COLLECTION).where({ userId: uid }).limit(1000).get()
    if (!Array.isArray(result?.data) || result.data.length >= 1000)
      throw new Error('测试身份支持记录无效或不完整')
    for (const supporter of result.data) {
      const key = `${supporter?.appId}:${uid}`
      if (!supporter || typeof supporter.appId !== 'string' || supporter.userId !== uid
        || !Number.isSafeInteger(supporter.totalCoins) || supporter.totalCoins < 0
        || !Number.isSafeInteger(supporter.tipCount) || supporter.tipCount < 0
        || supporterKeys.has(key)) {
        throw new Error('测试身份支持记录无效')
      }
      supporterKeys.add(key)
      const current = adjustments.get(supporter.appId) || { totalCoins: 0, supporterCount: 0, tipCount: 0 }
      adjustments.set(supporter.appId, {
        totalCoins: current.totalCoins + supporter.totalCoins,
        supporterCount: current.supporterCount + 1,
        tipCount: current.tipCount + supporter.tipCount,
      })
    }
  }
  return adjustments
}

function subtractSyntheticTipStats(stats, adjustment) {
  const values = {
    totalCoins: stats?.totalCoins || 0,
    supporterCount: stats?.supporterCount || 0,
    tipCount: stats?.tipCount || 0,
  }
  const excluded = adjustment || { totalCoins: 0, supporterCount: 0, tipCount: 0 }
  for (const key of Object.keys(values)) {
    if (!Number.isSafeInteger(values[key]) || values[key] < excluded[key])
      throw new Error('应用支持统计与测试身份明细不一致')
  }
  return {
    totalCoins: values.totalCoins - excluded.totalCoins,
    supporterCount: values.supporterCount - excluded.supporterCount,
    tipCount: values.tipCount - excluded.tipCount,
  }
}

module.exports = {
  APP_TIP_STATS_COLLECTION,
  APP_SUPPORTERS_COLLECTION,
  TIP_AMOUNT,
  TIP_DAILY_CAP_PER_APP,
  tipRefId,
  tip,
  getAppSupport,
  getTipLeaderboard,
}
