/**
 * AI point ledger for platform-managed AI workloads.
 *
 * This module is intentionally independent from lib/wallet.js. AI points use
 * microPoints, immutable transactions and their own reservation lifecycle.
 */

'use strict'

const crypto = require('node:crypto')

const {
  AI_POINT_ACCOUNTS_COLLECTION,
  AI_POINT_RESERVATIONS_COLLECTION,
  AI_POINT_TRANSACTIONS_COLLECTION,
} = require('./ai-point-resources')

const AI_POINT_ACCOUNT_SCHEMA_VERSION = 2
const AI_POINT_DAILY_CHARGE_LIMIT_MICROPOINTS = 5_000_000
const AI_POINT_MAX_ACTIVE_RESERVATIONS = 4
const AI_POINT_MAX_RESERVATION_TTL_MS = 24 * 60 * 60 * 1000
const AI_POINT_TASK_TRANSACTION_LIMIT = 1_000

function stableId(namespace, ...parts) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify([namespace, ...parts]))
    .digest('hex')
    .slice(0, 32)
}

function docData(result) {
  const document = Array.isArray(result?.data)
    ? result.data[0]
    : result?.data
  if (!document || typeof document !== 'object')
    return null
  const { _id: _documentId, ...data } = document
  return data
}

function docsData(result) {
  return Array.isArray(result?.data) ? result.data : []
}

function assertIdentifier(value, field, max = 128) {
  if (typeof value !== 'string' || !value || value.length > max || !/^[\w.:-]+$/.test(value))
    throw new Error(`${field} 无效`)
  return value
}

function assertMicroPoints(value, field, { allowZero = false } = {}) {
  if (!Number.isSafeInteger(value) || value < 0 || (!allowZero && value === 0))
    throw new Error(`${field} 必须为${allowZero ? '非负' : '正'}安全整数 microPoints`)
  return value
}

function assertSignedMicroPoints(value, field) {
  if (!Number.isSafeInteger(value) || value === 0)
    throw new Error(`${field} 必须为非 0 安全整数 microPoints`)
  return value
}

function assertTimestamp(value, field = 'now') {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${field} 必须为非负安全整数时间戳`)
  return value
}

function safeAdd(left, right, field) {
  const value = left + right
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${field} 超出安全整数范围`)
  return value
}

function safeSubtract(left, right, field) {
  const value = left - right
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${field} 不足或超出安全整数范围`)
  return value
}

function normalizeReason(value, required = false) {
  const reason = typeof value === 'string' ? value.trim() : ''
  if (required && !reason)
    throw new Error('reason 必填')
  if (reason.length > 500)
    throw new Error('reason 过长')
  return reason
}

function normalizeMeta(value) {
  if (value === undefined)
    return {}
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('meta 必须为对象')
  const entries = Object.entries(value)
  if (entries.length > 20)
    throw new Error('meta 字段过多')
  const meta = {}
  for (const [key, item] of entries) {
    assertIdentifier(key, 'meta key', 64)
    if (!['string', 'number', 'boolean'].includes(typeof item)
      || (typeof item === 'number' && !Number.isSafeInteger(item))) {
      throw new Error(`meta.${key} 必须为字符串、布尔值或安全整数`)
    }
    if (typeof item === 'string' && item.length > 256)
      throw new Error(`meta.${key} 过长`)
    meta[key] = item
  }
  return meta
}

function chinaDateKey(now) {
  return new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function accountId(userId) {
  return stableId('ai_point_account', userId)
}

function transactionId(userId, type, idempotencyKey) {
  return stableId('ai_point_transaction', userId, type, idempotencyKey)
}

function reservationId(userId, taskId) {
  return stableId('ai_point_reservation', userId, taskId)
}

function normalizeCommonInput(input) {
  if (!input || typeof input !== 'object')
    throw new Error('AI 点数参数必须为对象')
  return {
    userId: assertIdentifier(input.userId, 'userId'),
    appId: assertIdentifier(input.appId, 'appId', 80),
    scope: assertIdentifier(input.scope, 'scope', 80),
    idempotencyKey: assertIdentifier(input.idempotencyKey, 'idempotencyKey'),
    now: assertTimestamp(input.now),
  }
}

function normalizeGrantInput(input) {
  const common = normalizeCommonInput(input)
  const actor = input.actor === 'system' || input.actor === 'admin' ? input.actor : null
  if (!actor)
    throw new Error('actor 必须为 system 或 admin')
  return {
    ...common,
    amountMicroPoints: assertMicroPoints(input.amountMicroPoints, 'amountMicroPoints'),
    actor,
    operator: actor === 'admin' ? assertIdentifier(input.operator, 'operator') : '',
    reason: normalizeReason(input.reason, actor === 'admin'),
    meta: normalizeMeta(input.meta),
  }
}

function normalizeReserveInput(input) {
  const common = normalizeCommonInput(input)
  const reservationExpiresAt = assertTimestamp(input.reservationExpiresAt, 'reservationExpiresAt')
  if (reservationExpiresAt <= common.now)
    throw new Error('reservationExpiresAt 必须晚于 now')
  if (reservationExpiresAt - common.now > AI_POINT_MAX_RESERVATION_TTL_MS)
    throw new Error('reservationExpiresAt 不能超过 24 小时')
  return {
    ...common,
    taskId: assertIdentifier(input.taskId, 'taskId'),
    amountMicroPoints: assertMicroPoints(input.amountMicroPoints, 'amountMicroPoints'),
    reservationExpiresAt,
  }
}

function normalizeSettleInput(input) {
  const common = normalizeCommonInput(input)
  return {
    ...common,
    taskId: assertIdentifier(input.taskId, 'taskId'),
    chargedMicroPoints: assertMicroPoints(input.chargedMicroPoints, 'chargedMicroPoints', { allowZero: true }),
  }
}

function normalizeReleaseInput(input) {
  const common = normalizeCommonInput(input)
  return {
    ...common,
    taskId: assertIdentifier(input.taskId, 'taskId'),
    reason: normalizeReason(input.reason, true),
  }
}

function normalizeRefundInput(input) {
  const common = normalizeCommonInput(input)
  const actor = input.actor === 'system' || input.actor === 'admin' ? input.actor : null
  if (!actor)
    throw new Error('actor 必须为 system 或 admin')
  return {
    ...common,
    taskId: assertIdentifier(input.taskId, 'taskId'),
    amountMicroPoints: assertMicroPoints(input.amountMicroPoints, 'amountMicroPoints'),
    actor,
    operator: actor === 'admin' ? assertIdentifier(input.operator, 'operator') : '',
    reason: normalizeReason(input.reason, true),
    meta: normalizeMeta(input.meta),
  }
}

function normalizeAdjustInput(input) {
  const common = normalizeCommonInput(input)
  if (input.actor !== 'admin')
    throw new Error('AI 点数人工调整 actor 必须为 admin')
  return {
    ...common,
    deltaMicroPoints: assertSignedMicroPoints(input.deltaMicroPoints, 'deltaMicroPoints'),
    actor: 'admin',
    operator: assertIdentifier(input.operator, 'operator'),
    reason: normalizeReason(input.reason, true),
    meta: normalizeMeta(input.meta),
  }
}

function emptyDaily(now) {
  return {
    dateKey: chinaDateKey(now),
    reservedMicroPoints: 0,
    chargedMicroPoints: 0,
  }
}

function currentDaily(value, now) {
  const dateKey = chinaDateKey(now)
  if (!value || value.dateKey !== dateKey)
    return emptyDaily(now)
  return {
    dateKey,
    reservedMicroPoints: assertMicroPoints(value.reservedMicroPoints, 'daily.reservedMicroPoints', { allowZero: true }),
    chargedMicroPoints: assertMicroPoints(value.chargedMicroPoints, 'daily.chargedMicroPoints', { allowZero: true }),
  }
}

function newAccount(input) {
  return {
    schemaVersion: AI_POINT_ACCOUNT_SCHEMA_VERSION,
    userId: input.userId,
    availableMicroPoints: 0,
    reservedMicroPoints: 0,
    activeReservationCount: 0,
    lifetimeGrantedMicroPoints: 0,
    lifetimeChargedMicroPoints: 0,
    daily: emptyDaily(input.now),
    version: 0,
    createdAt: input.now,
    updatedAt: input.now,
  }
}

function assertAccount(account, userId) {
  if (!account || account.userId !== userId)
    throw new Error('AI 点数账户归属异常')
  if (account.schemaVersion !== AI_POINT_ACCOUNT_SCHEMA_VERSION)
    throw new Error('AI 点数账户需要迁移到 schema v2')
  for (const field of [
    'availableMicroPoints',
    'reservedMicroPoints',
    'activeReservationCount',
    'lifetimeGrantedMicroPoints',
    'lifetimeChargedMicroPoints',
    'version',
  ]) {
    assertMicroPoints(account[field], `account.${field}`, { allowZero: true })
  }
  currentDaily(account.daily, account.updatedAt)
  return account
}

function publicAccount(account) {
  return {
    schemaVersion: account.schemaVersion,
    userId: account.userId,
    availableMicroPoints: account.availableMicroPoints,
    reservedMicroPoints: account.reservedMicroPoints,
    activeReservationCount: account.activeReservationCount,
    lifetimeGrantedMicroPoints: account.lifetimeGrantedMicroPoints,
    lifetimeChargedMicroPoints: account.lifetimeChargedMicroPoints,
    daily: { ...account.daily },
    version: account.version,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  }
}

async function ensureAiPointAccount(db, rawInput) {
  const input = {
    userId: assertIdentifier(rawInput?.userId, 'userId'),
    now: assertTimestamp(rawInput?.now),
  }
  const accountDocumentId = accountId(input.userId)
  return db.runTransaction(async (transaction) => {
    const accountRef = transaction.collection(AI_POINT_ACCOUNTS_COLLECTION).doc(accountDocumentId)
    const current = docData(await accountRef.get())
    if (current) {
      return {
        initialized: true,
        created: false,
        account: publicAccount(assertAccount(current, input.userId)),
      }
    }
    const account = newAccount(input)
    await accountRef.set(account)
    return {
      initialized: true,
      created: true,
      account: publicAccount(account),
    }
  })
}

function replayAccount(existingTransaction, currentAccount, userId) {
  const snapshot = existingTransaction?.resultAccount
  if (snapshot)
    return publicAccount(assertAccount(snapshot, userId))
  return publicAccount(currentAccount)
}

function publicTransaction(transaction) {
  const result = { ...transaction }
  delete result.resultAccount
  return result
}

function assertTransactionMatches(existing, expected) {
  if (!existing)
    return
  for (const field of [
    'userId',
    'appId',
    'scope',
    'type',
    'idempotencyKey',
    'availableDelta',
    'reservedDelta',
    'taskId',
    'chargedMicroPoints',
    'actor',
    'operator',
    'reason',
    'operationHash',
  ]) {
    if (Object.hasOwn(expected, field) && existing[field] !== expected[field])
      throw new Error(`AI 点数幂等键冲突: ${field}`)
  }
}

async function grantAiPoints(db, rawInput) {
  const input = normalizeGrantInput(rawInput)
  const accountDocumentId = accountId(input.userId)
  const txDocumentId = transactionId(input.userId, 'grant', input.idempotencyKey)

  return db.runTransaction(async (transaction) => {
    const accountRef = transaction.collection(AI_POINT_ACCOUNTS_COLLECTION).doc(accountDocumentId)
    const txRef = transaction.collection(AI_POINT_TRANSACTIONS_COLLECTION).doc(txDocumentId)
    const existingTx = docData(await txRef.get())
    const expectedTx = {
      userId: input.userId,
      appId: input.appId,
      scope: input.scope,
      type: 'grant',
      idempotencyKey: input.idempotencyKey,
      availableDelta: input.amountMicroPoints,
      reservedDelta: 0,
      actor: input.actor,
      operator: input.operator,
      operationHash: stableId('ai_point_operation', 'grant', {
        userId: input.userId,
        appId: input.appId,
        scope: input.scope,
        amountMicroPoints: input.amountMicroPoints,
        actor: input.actor,
        operator: input.operator,
        reason: input.reason,
        meta: input.meta,
      }),
    }
    assertTransactionMatches(existingTx, expectedTx)
    if (existingTx) {
      const existingAccount = assertAccount(docData(await accountRef.get()), input.userId)
      return {
        account: replayAccount(existingTx, existingAccount, input.userId),
        transactionId: txDocumentId,
        deduped: true,
      }
    }

    const current = docData(await accountRef.get())
    const account = current ? assertAccount(current, input.userId) : newAccount(input)
    const next = {
      ...account,
      availableMicroPoints: safeAdd(account.availableMicroPoints, input.amountMicroPoints, 'availableMicroPoints'),
      lifetimeGrantedMicroPoints: safeAdd(account.lifetimeGrantedMicroPoints, input.amountMicroPoints, 'lifetimeGrantedMicroPoints'),
      version: safeAdd(account.version, 1, 'version'),
      updatedAt: input.now,
    }
    await accountRef.set(next)
    await txRef.set({
      ...expectedTx,
      taskId: '',
      chargedMicroPoints: 0,
      availableAfter: next.availableMicroPoints,
      reservedAfter: next.reservedMicroPoints,
      reason: input.reason,
      meta: input.meta,
      resultAccount: publicAccount(next),
      createdAt: input.now,
    })
    return {
      account: publicAccount(next),
      transactionId: txDocumentId,
      deduped: false,
    }
  })
}

async function reserveAiPoints(db, rawInput) {
  const input = normalizeReserveInput(rawInput)
  const accountDocumentId = accountId(input.userId)
  const reservationDocumentId = reservationId(input.userId, input.taskId)
  const txDocumentId = transactionId(input.userId, 'reserve', input.idempotencyKey)

  return db.runTransaction(async (transaction) => {
    const accountRef = transaction.collection(AI_POINT_ACCOUNTS_COLLECTION).doc(accountDocumentId)
    const reservationRef = transaction.collection(AI_POINT_RESERVATIONS_COLLECTION).doc(reservationDocumentId)
    const txRef = transaction.collection(AI_POINT_TRANSACTIONS_COLLECTION).doc(txDocumentId)
    const existingTx = docData(await txRef.get())
    const expectedTx = {
      userId: input.userId,
      appId: input.appId,
      scope: input.scope,
      taskId: input.taskId,
      type: 'reserve',
      idempotencyKey: input.idempotencyKey,
      availableDelta: -input.amountMicroPoints,
      reservedDelta: input.amountMicroPoints,
      chargedMicroPoints: 0,
      operationHash: stableId('ai_point_operation', 'reserve', {
        userId: input.userId,
        appId: input.appId,
        scope: input.scope,
        taskId: input.taskId,
        amountMicroPoints: input.amountMicroPoints,
      }),
    }
    assertTransactionMatches(existingTx, expectedTx)
    if (existingTx) {
      const existingAccount = assertAccount(docData(await accountRef.get()), input.userId)
      return {
        account: replayAccount(existingTx, existingAccount, input.userId),
        transactionId: txDocumentId,
        deduped: true,
      }
    }

    const account = assertAccount(docData(await accountRef.get()), input.userId)
    if (docData(await reservationRef.get()))
      throw new Error('AI 任务已有点数预留')
    if (account.activeReservationCount >= AI_POINT_MAX_ACTIVE_RESERVATIONS)
      throw new Error('用户 AI 并发预留已达上限')

    const daily = currentDaily(account.daily, input.now)
    const dailyExposure = safeAdd(
      daily.chargedMicroPoints,
      daily.reservedMicroPoints,
      'daily AI 点数暴露',
    )
    if (safeAdd(dailyExposure, input.amountMicroPoints, 'daily AI 点数暴露') > AI_POINT_DAILY_CHARGE_LIMIT_MICROPOINTS)
      throw new Error('用户当日 AI 点数额度不足')
    if (account.availableMicroPoints < input.amountMicroPoints)
      throw new Error('AI 点数余额不足')

    const next = {
      ...account,
      availableMicroPoints: safeSubtract(account.availableMicroPoints, input.amountMicroPoints, 'availableMicroPoints'),
      reservedMicroPoints: safeAdd(account.reservedMicroPoints, input.amountMicroPoints, 'reservedMicroPoints'),
      activeReservationCount: safeAdd(account.activeReservationCount, 1, 'activeReservationCount'),
      daily: {
        ...daily,
        reservedMicroPoints: safeAdd(daily.reservedMicroPoints, input.amountMicroPoints, 'daily.reservedMicroPoints'),
      },
      version: safeAdd(account.version, 1, 'version'),
      updatedAt: input.now,
    }
    await accountRef.set(next)
    await reservationRef.set({
      userId: input.userId,
      taskId: input.taskId,
      appId: input.appId,
      scope: input.scope,
      reservedMicroPoints: input.amountMicroPoints,
      status: 'active',
      expiresAt: input.reservationExpiresAt,
      createdAt: input.now,
      updatedAt: input.now,
    })
    await txRef.set({
      ...expectedTx,
      availableAfter: next.availableMicroPoints,
      reservedAfter: next.reservedMicroPoints,
      actor: 'system',
      reason: '',
      meta: {},
      resultAccount: publicAccount(next),
      createdAt: input.now,
    })
    return {
      account: publicAccount(next),
      transactionId: txDocumentId,
      deduped: false,
    }
  })
}

async function settleAiPoints(db, rawInput) {
  const input = normalizeSettleInput(rawInput)
  const accountDocumentId = accountId(input.userId)
  const reservationDocumentId = reservationId(input.userId, input.taskId)
  const txDocumentId = transactionId(input.userId, 'settle', input.idempotencyKey)

  return db.runTransaction(async (transaction) => {
    const accountRef = transaction.collection(AI_POINT_ACCOUNTS_COLLECTION).doc(accountDocumentId)
    const reservationRef = transaction.collection(AI_POINT_RESERVATIONS_COLLECTION).doc(reservationDocumentId)
    const txRef = transaction.collection(AI_POINT_TRANSACTIONS_COLLECTION).doc(txDocumentId)
    const existingTx = docData(await txRef.get())
    const expectedTx = {
      userId: input.userId,
      appId: input.appId,
      scope: input.scope,
      taskId: input.taskId,
      type: 'settle',
      idempotencyKey: input.idempotencyKey,
      chargedMicroPoints: input.chargedMicroPoints,
      operationHash: stableId('ai_point_operation', 'settle', {
        userId: input.userId,
        appId: input.appId,
        scope: input.scope,
        taskId: input.taskId,
        chargedMicroPoints: input.chargedMicroPoints,
      }),
    }
    assertTransactionMatches(existingTx, expectedTx)
    if (existingTx) {
      const existingAccount = assertAccount(docData(await accountRef.get()), input.userId)
      return {
        account: replayAccount(existingTx, existingAccount, input.userId),
        transactionId: txDocumentId,
        deduped: true,
      }
    }

    const account = assertAccount(docData(await accountRef.get()), input.userId)
    const reservation = docData(await reservationRef.get())
    if (!reservation || reservation.status !== 'active')
      throw new Error('AI 任务没有可结算的点数预占')
    if (reservation.appId !== input.appId || reservation.scope !== input.scope)
      throw new Error('AI 结算应用或 scope 与原预占不一致')
    const reservedForTask = assertMicroPoints(
      reservation.reservedMicroPoints,
      'reservation.reservedMicroPoints',
    )
    if (input.chargedMicroPoints > reservedForTask)
      throw new Error('实际 AI 点数消耗超过任务预占')
    if (account.reservedMicroPoints < reservedForTask)
      throw new Error('AI 点数总预占余额异常')

    const releasedMicroPoints = reservedForTask - input.chargedMicroPoints
    const daily = currentDaily(account.daily, input.now)
    const sameDate = account.daily?.dateKey === daily.dateKey
    const nextDailyReserved = sameDate
      ? safeSubtract(daily.reservedMicroPoints, reservedForTask, 'daily.reservedMicroPoints')
      : 0
    const next = {
      ...account,
      availableMicroPoints: safeAdd(account.availableMicroPoints, releasedMicroPoints, 'availableMicroPoints'),
      reservedMicroPoints: safeSubtract(account.reservedMicroPoints, reservedForTask, 'reservedMicroPoints'),
      activeReservationCount: safeSubtract(account.activeReservationCount, 1, 'activeReservationCount'),
      lifetimeChargedMicroPoints: safeAdd(account.lifetimeChargedMicroPoints, input.chargedMicroPoints, 'lifetimeChargedMicroPoints'),
      daily: {
        ...daily,
        reservedMicroPoints: nextDailyReserved,
        chargedMicroPoints: safeAdd(daily.chargedMicroPoints, input.chargedMicroPoints, 'daily.chargedMicroPoints'),
      },
      version: safeAdd(account.version, 1, 'version'),
      updatedAt: input.now,
    }
    await accountRef.set(next)
    await reservationRef.set({
      ...reservation,
      status: 'settled',
      chargedMicroPoints: input.chargedMicroPoints,
      releasedMicroPoints,
      settledAt: input.now,
      updatedAt: input.now,
    })
    await txRef.set({
      ...expectedTx,
      availableDelta: releasedMicroPoints,
      reservedDelta: -reservedForTask,
      availableAfter: next.availableMicroPoints,
      reservedAfter: next.reservedMicroPoints,
      actor: 'system',
      reason: '',
      meta: {},
      resultAccount: publicAccount(next),
      createdAt: input.now,
    })
    return {
      account: publicAccount(next),
      transactionId: txDocumentId,
      deduped: false,
    }
  })
}

async function releaseAiPoints(db, rawInput) {
  const input = normalizeReleaseInput(rawInput)
  const accountDocumentId = accountId(input.userId)
  const reservationDocumentId = reservationId(input.userId, input.taskId)
  const txDocumentId = transactionId(input.userId, 'release', input.idempotencyKey)

  return db.runTransaction(async (transaction) => {
    const accountRef = transaction.collection(AI_POINT_ACCOUNTS_COLLECTION).doc(accountDocumentId)
    const reservationRef = transaction.collection(AI_POINT_RESERVATIONS_COLLECTION).doc(reservationDocumentId)
    const txRef = transaction.collection(AI_POINT_TRANSACTIONS_COLLECTION).doc(txDocumentId)
    const existingTx = docData(await txRef.get())
    const expectedTx = {
      userId: input.userId,
      appId: input.appId,
      scope: input.scope,
      taskId: input.taskId,
      type: 'release',
      idempotencyKey: input.idempotencyKey,
      chargedMicroPoints: 0,
      reason: input.reason,
      operationHash: stableId('ai_point_operation', 'release', {
        userId: input.userId,
        appId: input.appId,
        scope: input.scope,
        taskId: input.taskId,
        reason: input.reason,
      }),
    }
    assertTransactionMatches(existingTx, expectedTx)
    if (existingTx) {
      const existingAccount = assertAccount(docData(await accountRef.get()), input.userId)
      return {
        account: replayAccount(existingTx, existingAccount, input.userId),
        transactionId: txDocumentId,
        deduped: true,
      }
    }

    const account = assertAccount(docData(await accountRef.get()), input.userId)
    const reservation = docData(await reservationRef.get())
    if (!reservation || reservation.status !== 'active')
      throw new Error('AI 任务没有可释放的点数预占')
    if (reservation.appId !== input.appId || reservation.scope !== input.scope)
      throw new Error('AI 释放应用或 scope 与原预占不一致')
    const reservedForTask = assertMicroPoints(
      reservation.reservedMicroPoints,
      'reservation.reservedMicroPoints',
    )
    if (account.reservedMicroPoints < reservedForTask)
      throw new Error('AI 点数总预占余额异常')

    const daily = currentDaily(account.daily, input.now)
    const sameDate = account.daily?.dateKey === daily.dateKey
    const next = {
      ...account,
      availableMicroPoints: safeAdd(account.availableMicroPoints, reservedForTask, 'availableMicroPoints'),
      reservedMicroPoints: safeSubtract(account.reservedMicroPoints, reservedForTask, 'reservedMicroPoints'),
      activeReservationCount: safeSubtract(account.activeReservationCount, 1, 'activeReservationCount'),
      daily: {
        ...daily,
        reservedMicroPoints: sameDate
          ? safeSubtract(daily.reservedMicroPoints, reservedForTask, 'daily.reservedMicroPoints')
          : 0,
      },
      version: safeAdd(account.version, 1, 'version'),
      updatedAt: input.now,
    }
    await accountRef.set(next)
    await reservationRef.set({
      ...reservation,
      status: 'released',
      releasedMicroPoints: reservedForTask,
      releaseReason: input.reason,
      releasedAt: input.now,
      updatedAt: input.now,
    })
    await txRef.set({
      ...expectedTx,
      availableDelta: reservedForTask,
      reservedDelta: -reservedForTask,
      availableAfter: next.availableMicroPoints,
      reservedAfter: next.reservedMicroPoints,
      actor: 'system',
      meta: {},
      resultAccount: publicAccount(next),
      createdAt: input.now,
    })
    return {
      account: publicAccount(next),
      transactionId: txDocumentId,
      deduped: false,
    }
  })
}

/**
 * 有界释放已过期的 AI 点数预留。恢复流程只筛选候选记录，实际写入复用
 * releaseAiPoints，确保账户、预留与不可变流水仍由唯一事务路径维护。
 */
async function releaseExpiredAiPointReservations(db, input) {
  const now = input?.now
  const limit = input?.limit ?? 50
  if (!Number.isSafeInteger(now))
    throw new Error('releaseExpiredAiPointReservations.now 无效')
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error('releaseExpiredAiPointReservations.limit 必须在 1 到 100 之间')

  const { data } = await db
    .collection(AI_POINT_RESERVATIONS_COLLECTION)
    .where({ status: 'active', expiresAt: db.command.lte(now) })
    .orderBy('expiresAt', 'asc')
    .limit(limit)
    .get()
  const reservations = Array.isArray(data) ? data : []
  let released = 0
  let failed = 0
  for (const reservation of reservations) {
    try {
      await releaseAiPoints(db, {
        userId: reservation.userId,
        appId: reservation.appId,
        scope: reservation.scope,
        taskId: reservation.taskId,
        idempotencyKey: `reservation-expired:${reservation.taskId}:${reservation.expiresAt}`,
        reason: 'reservation_expired',
        now,
      })
      released++
    }
    catch {
      failed++
    }
  }
  return { scanned: reservations.length, released, failed }
}

async function refundAiPoints(db, rawInput) {
  const input = normalizeRefundInput(rawInput)
  const accountDocumentId = accountId(input.userId)
  const txDocumentId = transactionId(input.userId, 'refund', input.idempotencyKey)

  return db.runTransaction(async (transaction) => {
    const accountRef = transaction.collection(AI_POINT_ACCOUNTS_COLLECTION).doc(accountDocumentId)
    const txRef = transaction.collection(AI_POINT_TRANSACTIONS_COLLECTION).doc(txDocumentId)
    const existingTx = docData(await txRef.get())
    const expectedTx = {
      userId: input.userId,
      appId: input.appId,
      scope: input.scope,
      taskId: input.taskId,
      type: 'refund',
      idempotencyKey: input.idempotencyKey,
      availableDelta: input.amountMicroPoints,
      reservedDelta: 0,
      chargedMicroPoints: -input.amountMicroPoints,
      actor: input.actor,
      operator: input.operator,
      reason: input.reason,
      operationHash: stableId('ai_point_operation', 'refund', {
        userId: input.userId,
        appId: input.appId,
        scope: input.scope,
        taskId: input.taskId,
        amountMicroPoints: input.amountMicroPoints,
        actor: input.actor,
        operator: input.operator,
        reason: input.reason,
        meta: input.meta,
      }),
    }
    assertTransactionMatches(existingTx, expectedTx)
    if (existingTx) {
      const existingAccount = assertAccount(docData(await accountRef.get()), input.userId)
      return {
        account: replayAccount(existingTx, existingAccount, input.userId),
        transactionId: txDocumentId,
        deduped: true,
      }
    }

    const account = assertAccount(docData(await accountRef.get()), input.userId)
    const taskTransactions = docsData(await transaction
      .collection(AI_POINT_TRANSACTIONS_COLLECTION)
      .where({ userId: input.userId, taskId: input.taskId })
      .limit(AI_POINT_TASK_TRANSACTION_LIMIT)
      .get())
    if (taskTransactions.length >= AI_POINT_TASK_TRANSACTION_LIMIT)
      throw new Error('AI 任务退款流水达到安全上限，需要人工对账')
    const settlements = taskTransactions.filter(item => item.type === 'settle')
    if (settlements.length !== 1)
      throw new Error('AI 任务没有唯一可退款结算流水')
    const settlement = settlements[0]
    if (settlement.appId !== input.appId || settlement.scope !== input.scope)
      throw new Error('AI 退款应用或 scope 与原结算不一致')
    const settledCharge = assertMicroPoints(
      settlement.chargedMicroPoints,
      'settlement.chargedMicroPoints',
      { allowZero: true },
    )
    const alreadyRefunded = taskTransactions
      .filter(item => item.type === 'refund')
      .reduce((total, item) => safeAdd(
        total,
        assertMicroPoints(item.availableDelta, 'refund.availableDelta'),
        'task refundedMicroPoints',
      ), 0)
    const refundable = safeSubtract(settledCharge, alreadyRefunded, 'task refundableMicroPoints')
    if (input.amountMicroPoints > refundable)
      throw new Error('退款金额超过任务可退款金额')
    if (account.lifetimeChargedMicroPoints < input.amountMicroPoints)
      throw new Error('AI 点数累计扣费不足以退款')

    const daily = currentDaily(account.daily, input.now)
    const settlementDateKey = chinaDateKey(assertTimestamp(settlement.createdAt, 'settlement.createdAt'))
    const nextDailyCharged = daily.dateKey === settlementDateKey
      ? safeSubtract(daily.chargedMicroPoints, input.amountMicroPoints, 'daily.chargedMicroPoints')
      : daily.chargedMicroPoints
    const next = {
      ...account,
      availableMicroPoints: safeAdd(account.availableMicroPoints, input.amountMicroPoints, 'availableMicroPoints'),
      lifetimeChargedMicroPoints: safeSubtract(account.lifetimeChargedMicroPoints, input.amountMicroPoints, 'lifetimeChargedMicroPoints'),
      daily: {
        ...daily,
        chargedMicroPoints: nextDailyCharged,
      },
      version: safeAdd(account.version, 1, 'version'),
      updatedAt: input.now,
    }
    await accountRef.set(next)
    await txRef.set({
      ...expectedTx,
      availableAfter: next.availableMicroPoints,
      reservedAfter: next.reservedMicroPoints,
      meta: input.meta,
      resultAccount: publicAccount(next),
      createdAt: input.now,
    })
    return {
      account: publicAccount(next),
      transactionId: txDocumentId,
      deduped: false,
    }
  })
}

async function adjustAiPoints(db, rawInput) {
  const input = normalizeAdjustInput(rawInput)
  const accountDocumentId = accountId(input.userId)
  const txDocumentId = transactionId(input.userId, 'adjust', input.idempotencyKey)

  return db.runTransaction(async (transaction) => {
    const accountRef = transaction.collection(AI_POINT_ACCOUNTS_COLLECTION).doc(accountDocumentId)
    const txRef = transaction.collection(AI_POINT_TRANSACTIONS_COLLECTION).doc(txDocumentId)
    const existingTx = docData(await txRef.get())
    const expectedTx = {
      userId: input.userId,
      appId: input.appId,
      scope: input.scope,
      taskId: '',
      type: 'adjust',
      idempotencyKey: input.idempotencyKey,
      availableDelta: input.deltaMicroPoints,
      reservedDelta: 0,
      chargedMicroPoints: 0,
      reason: input.reason,
      operationHash: stableId('ai_point_operation', 'adjust', {
        userId: input.userId,
        appId: input.appId,
        scope: input.scope,
        deltaMicroPoints: input.deltaMicroPoints,
        operator: input.operator,
        reason: input.reason,
        meta: input.meta,
      }),
    }
    assertTransactionMatches(existingTx, expectedTx)
    if (existingTx) {
      const existingAccount = assertAccount(docData(await accountRef.get()), input.userId)
      return {
        account: replayAccount(existingTx, existingAccount, input.userId),
        transactionId: txDocumentId,
        deduped: true,
      }
    }

    const account = assertAccount(docData(await accountRef.get()), input.userId)
    if (input.deltaMicroPoints < 0 && account.availableMicroPoints < -input.deltaMicroPoints)
      throw new Error('AI 点数可用余额不足')
    const availableMicroPoints = input.deltaMicroPoints > 0
      ? safeAdd(account.availableMicroPoints, input.deltaMicroPoints, 'availableMicroPoints')
      : safeSubtract(account.availableMicroPoints, -input.deltaMicroPoints, 'availableMicroPoints')
    const next = {
      ...account,
      availableMicroPoints,
      version: safeAdd(account.version, 1, 'version'),
      updatedAt: input.now,
    }
    await accountRef.set(next)
    await txRef.set({
      ...expectedTx,
      availableAfter: next.availableMicroPoints,
      reservedAfter: next.reservedMicroPoints,
      actor: input.actor,
      operator: input.operator,
      meta: input.meta,
      resultAccount: publicAccount(next),
      createdAt: input.now,
    })
    return {
      account: publicAccount(next),
      transactionId: txDocumentId,
      deduped: false,
    }
  })
}

async function getAiPointAccount(db, userId) {
  const normalizedUserId = assertIdentifier(userId, 'userId')
  const account = docData(await db
    .collection(AI_POINT_ACCOUNTS_COLLECTION)
    .doc(accountId(normalizedUserId))
    .get())
  return account ? publicAccount(assertAccount(account, normalizedUserId)) : null
}

async function listAiPointTransactions(db, input = {}) {
  const userId = assertIdentifier(input.userId, 'userId')
  const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 100)
  const skip = Math.max(Number(input.skip) || 0, 0)
  if (!Number.isSafeInteger(limit) || !Number.isSafeInteger(skip))
    throw new Error('AI 点数流水分页参数无效')
  const result = await db
    .collection(AI_POINT_TRANSACTIONS_COLLECTION)
    .where({ userId })
    .orderBy('createdAt', 'desc')
    .skip(skip)
    .limit(limit)
    .get()
  const items = docsData(result).map(publicTransaction)
  return {
    items,
    nextSkip: items.length === limit ? skip + limit : null,
  }
}

module.exports = {
  AI_POINT_ACCOUNT_SCHEMA_VERSION,
  AI_POINT_ACCOUNTS_COLLECTION,
  AI_POINT_DAILY_CHARGE_LIMIT_MICROPOINTS,
  AI_POINT_MAX_ACTIVE_RESERVATIONS,
  AI_POINT_RESERVATIONS_COLLECTION,
  AI_POINT_TRANSACTIONS_COLLECTION,
  adjustAiPoints,
  aiPointReservationId: reservationId,
  ensureAiPointAccount,
  getAiPointAccount,
  grantAiPoints,
  listAiPointTransactions,
  releaseExpiredAiPointReservations,
  releaseAiPoints,
  reserveAiPoints,
  refundAiPoints,
  settleAiPoints,
}
