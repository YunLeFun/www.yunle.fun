'use strict'

const crypto = require('node:crypto')

const DAILY_QUOTA_COLLECTION = 'ai_usage_daily'
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000

function shanghaiDateKey(now = Date.now()) {
  return new Date(now + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10)
}

function quotaDocumentId({ uid, appId, dateKey }) {
  return crypto
    .createHash('sha256')
    .update(`${uid}\n${appId}\n${dateKey}`)
    .digest('hex')
}

function isDuplicateDocumentError(error) {
  if (!error || typeof error !== 'object')
    return false
  const code = typeof error.code === 'string' ? error.code : ''
  const message = typeof error.message === 'string' ? error.message : ''
  return code === 'DATABASE_DUPLICATE_KEY'
    || code === 'DUPLICATE_KEY'
    || /duplicate|E11000/i.test(message)
}

async function ensureQuotaDocument(collection, document) {
  try {
    await collection.add(document)
  }
  catch (error) {
    if (!isDuplicateDocumentError(error))
      throw error
  }
}

function readUpdatedCount(result) {
  return typeof result?.updated === 'number' ? result.updated : 0
}

async function readQuotaUsage(collection, id, limit) {
  const snapshot = await collection.doc(id).get()
  const document = Array.isArray(snapshot?.data) ? snapshot.data[0] : null
  const used = typeof document?.used === 'number' ? document.used : limit
  return {
    allowed: used <= limit,
    limit,
    remaining: Math.max(0, limit - used),
    used,
  }
}

async function reserveDailyQuota(db, { uid, appId, limit, now = Date.now() }) {
  const dateKey = shanghaiDateKey(now)
  const id = quotaDocumentId({ uid, appId, dateKey })
  const collection = db.collection(DAILY_QUOTA_COLLECTION)
  await ensureQuotaDocument(collection, {
    _id: id,
    appId,
    createdAt: now,
    dateKey,
    limit,
    uid,
    updatedAt: now,
    used: 0,
  })

  const _ = db.command
  const result = await collection
    .where({ _id: id, used: _.lt(limit) })
    .update({ limit, updatedAt: now, used: _.inc(1) })

  if (readUpdatedCount(result) === 0) {
    const usage = await readQuotaUsage(collection, id, limit)
    return { ...usage, allowed: false, dateKey, documentId: id }
  }

  const usage = await readQuotaUsage(collection, id, limit)
  return { ...usage, allowed: true, dateKey, documentId: id }
}

async function releaseDailyQuota(db, { documentId, now = Date.now() }) {
  const _ = db.command
  const result = await db
    .collection(DAILY_QUOTA_COLLECTION)
    .where({ _id: documentId, used: _.gt(0) })
    .update({ updatedAt: now, used: _.inc(-1) })
  if (readUpdatedCount(result) !== 1)
    throw new Error('AI 日额度回滚失败')
}

async function runQuotaChat({ uid, messages }, deps) {
  if (!uid)
    return { ok: false, code: 'unauthorized', message: '请先登录后再使用。' }

  const reservation = await deps.reserve()
  if (!reservation.allowed) {
    return {
      ok: false,
      code: 'quota_exhausted',
      message: '今日 AI 游玩额度已用完。',
      quota: {
        limit: reservation.limit,
        remaining: 0,
        used: reservation.used,
      },
    }
  }

  let content = ''
  try {
    content = await deps.generate(messages)
  }
  catch {
    content = ''
  }

  if (!content || !content.trim()) {
    await deps.release(reservation)
    return { ok: false, code: 'ai_failed', message: '模型生成失败，请重试（未消耗额度）。' }
  }

  return {
    ok: true,
    content,
    balance: null,
    deduped: false,
    quota: {
      limit: reservation.limit,
      remaining: reservation.remaining,
      used: reservation.used,
    },
  }
}

module.exports = {
  DAILY_QUOTA_COLLECTION,
  quotaDocumentId,
  releaseDailyQuota,
  reserveDailyQuota,
  runQuotaChat,
  shanghaiDateKey,
}
