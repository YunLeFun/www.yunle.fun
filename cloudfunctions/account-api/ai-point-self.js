'use strict'

const { Buffer } = require('node:buffer')

const {
  AI_POINT_TRANSACTIONS_COLLECTION,
  ensureAiPointAccount,
} = require('./ai-points')

const AI_POINT_SELF_SCHEMA_VERSION = 2
const DEFAULT_PAGE_LIMIT = 20
const MAX_PAGE_LIMIT = 50
const MAX_CURSOR_LENGTH = 256
const MAX_CURSOR_OFFSET = 1_000_000

function assertUserId(userId) {
  if (typeof userId !== 'string' || !userId.trim())
    throw new Error('登录用户无效')
  return userId.trim()
}

function requiredString(value, field) {
  if (typeof value !== 'string' || !value)
    throw new Error(`AI 点数流水 ${field} 无效`)
  return value
}

function safeInteger(value, field) {
  if (!Number.isSafeInteger(value))
    throw new Error(`AI 点数流水 ${field} 无效`)
  return value
}

function projectAccount(account) {
  return {
    initialized: true,
    availableMicroPoints: safeInteger(account.availableMicroPoints, 'account.availableMicroPoints'),
    reservedMicroPoints: safeInteger(account.reservedMicroPoints, 'account.reservedMicroPoints'),
    activeReservationCount: safeInteger(account.activeReservationCount, 'account.activeReservationCount'),
    lifetimeGrantedMicroPoints: safeInteger(account.lifetimeGrantedMicroPoints, 'account.lifetimeGrantedMicroPoints'),
    lifetimeChargedMicroPoints: safeInteger(account.lifetimeChargedMicroPoints, 'account.lifetimeChargedMicroPoints'),
    updatedAt: safeInteger(account.updatedAt, 'account.updatedAt'),
  }
}

function projectTransaction(transaction) {
  return {
    id: requiredString(transaction?._id, 'id'),
    type: requiredString(transaction?.type, 'type'),
    appId: requiredString(transaction?.appId, 'appId'),
    scope: requiredString(transaction?.scope, 'scope'),
    taskId: typeof transaction?.taskId === 'string' && transaction.taskId ? transaction.taskId : null,
    availableDelta: safeInteger(transaction?.availableDelta, 'availableDelta'),
    reservedDelta: safeInteger(transaction?.reservedDelta, 'reservedDelta'),
    chargedMicroPoints: safeInteger(transaction?.chargedMicroPoints, 'chargedMicroPoints'),
    availableAfter: safeInteger(transaction?.availableAfter, 'availableAfter'),
    reservedAfter: safeInteger(transaction?.reservedAfter, 'reservedAfter'),
    createdAt: safeInteger(transaction?.createdAt, 'createdAt'),
  }
}

function parseLimit(value) {
  if (value === undefined || value === null || value === '')
    return DEFAULT_PAGE_LIMIT
  const limit = Number(value)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT)
    throw new Error(`AI 点数流水 limit 必须为 1～${MAX_PAGE_LIMIT} 的整数`)
  return limit
}

function encodeCursor(state) {
  return Buffer.from(JSON.stringify({
    v: AI_POINT_SELF_SCHEMA_VERSION,
    s: state.snapshotBefore,
    o: state.offset,
  })).toString('base64url')
}

function decodeCursor(cursor, now) {
  if (cursor === undefined || cursor === null || cursor === '')
    return { snapshotBefore: now, offset: 0 }
  if (typeof cursor !== 'string' || cursor.length > MAX_CURSOR_LENGTH)
    throw new Error('AI 点数流水游标无效')
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    const state = { snapshotBefore: value?.s, offset: value?.o }
    if (value?.v !== AI_POINT_SELF_SCHEMA_VERSION
      || !Number.isSafeInteger(state.snapshotBefore)
      || state.snapshotBefore < 0
      || state.snapshotBefore > now
      || !Number.isSafeInteger(state.offset)
      || state.offset < 0
      || state.offset > MAX_CURSOR_OFFSET
      || encodeCursor(state) !== cursor) {
      throw new Error('invalid cursor payload')
    }
    return state
  }
  catch {
    throw new Error('AI 点数流水游标无效')
  }
}

async function handleGetMyAiPointAccount(db, callerUserId, options = {}) {
  const ensured = await ensureAiPointAccount(db, {
    userId: assertUserId(callerUserId),
    now: options.now ?? Date.now(),
  })
  return {
    schemaVersion: AI_POINT_SELF_SCHEMA_VERSION,
    account: projectAccount(ensured.account),
  }
}

async function handleListMyAiPointTransactions(db, callerUserId, event = {}, options = {}) {
  const userId = assertUserId(callerUserId)
  const now = options.now ?? Date.now()
  if (!Number.isSafeInteger(now) || now < 0)
    throw new Error('服务端时间无效')
  const limit = parseLimit(event?.limit)
  const state = decodeCursor(event?.cursor, now)
  const result = await db
    .collection(AI_POINT_TRANSACTIONS_COLLECTION)
    .where({ userId, createdAt: db.command.lt(state.snapshotBefore) })
    .orderBy('createdAt', 'desc')
    .skip(state.offset)
    .limit(limit + 1)
    .get()
  const documents = Array.isArray(result?.data) ? result.data : []
  const hasMore = documents.length > limit
  const items = documents.slice(0, limit).map(projectTransaction)
  return {
    schemaVersion: AI_POINT_SELF_SCHEMA_VERSION,
    items,
    nextCursor: hasMore
      ? encodeCursor({ snapshotBefore: state.snapshotBefore, offset: state.offset + items.length })
      : null,
  }
}

module.exports = {
  AI_POINT_SELF_SCHEMA_VERSION,
  handleGetMyAiPointAccount,
  handleListMyAiPointTransactions,
}
