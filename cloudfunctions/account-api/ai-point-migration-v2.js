'use strict'

const {
  AI_POINT_ACCOUNTS_COLLECTION,
  AI_POINT_RESERVATIONS_COLLECTION,
} = require('./ai-point-resources')
const {
  AI_POINT_ACCOUNT_SCHEMA_VERSION,
  aiPointReservationId,
} = require('./ai-points')

const PAGE_SIZE = 100

function safeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`${field} 必须为非负安全整数`)
  return value
}

function requiredString(value, field) {
  if (typeof value !== 'string' || !value)
    throw new Error(`${field} 无效`)
  return value
}

async function listAccounts(db) {
  const accounts = []
  for (let skip = 0; ; skip += PAGE_SIZE) {
    const result = await db
      .collection(AI_POINT_ACCOUNTS_COLLECTION)
      .skip(skip)
      .limit(PAGE_SIZE)
      .get()
    const page = Array.isArray(result?.data) ? result.data : []
    accounts.push(...page)
    if (page.length < PAGE_SIZE)
      return accounts
  }
}

function migrationCandidate(account) {
  if (!account || account.schemaVersion === AI_POINT_ACCOUNT_SCHEMA_VERSION)
    return null
  const userId = requiredString(account.userId, 'account.userId')
  const activeTask = account.activeTask
  if (activeTask) {
    requiredString(activeTask.taskId, 'account.activeTask.taskId')
    requiredString(activeTask.appId, 'account.activeTask.appId')
    requiredString(activeTask.scope, 'account.activeTask.scope')
    safeInteger(activeTask.reservedMicroPoints, 'account.activeTask.reservedMicroPoints')
    safeInteger(activeTask.expiresAt, 'account.activeTask.expiresAt')
  }
  const daily = account.daily || {}
  const { _id, access: _access, activeTask: _activeTask, ...rest } = account
  return {
    accountId: requiredString(_id, 'account._id'),
    nextAccount: {
      ...rest,
      schemaVersion: AI_POINT_ACCOUNT_SCHEMA_VERSION,
      userId,
      availableMicroPoints: safeInteger(account.availableMicroPoints, 'account.availableMicroPoints'),
      reservedMicroPoints: safeInteger(account.reservedMicroPoints, 'account.reservedMicroPoints'),
      activeReservationCount: activeTask ? 1 : 0,
      lifetimeGrantedMicroPoints: safeInteger(account.lifetimeGrantedMicroPoints, 'account.lifetimeGrantedMicroPoints'),
      lifetimeChargedMicroPoints: safeInteger(account.lifetimeChargedMicroPoints, 'account.lifetimeChargedMicroPoints'),
      daily: {
        dateKey: requiredString(daily.dateKey, 'account.daily.dateKey'),
        reservedMicroPoints: safeInteger(daily.reservedMicroPoints, 'account.daily.reservedMicroPoints'),
        chargedMicroPoints: safeInteger(daily.chargedMicroPoints, 'account.daily.chargedMicroPoints'),
      },
      version: safeInteger(account.version, 'account.version'),
      createdAt: safeInteger(account.createdAt, 'account.createdAt'),
      updatedAt: safeInteger(account.updatedAt, 'account.updatedAt'),
    },
    reservation: activeTask
      ? {
          id: aiPointReservationId(userId, activeTask.taskId),
          value: {
            userId,
            taskId: activeTask.taskId,
            appId: activeTask.appId,
            scope: activeTask.scope,
            reservedMicroPoints: activeTask.reservedMicroPoints,
            status: 'active',
            expiresAt: activeTask.expiresAt,
            createdAt: account.updatedAt,
            updatedAt: account.updatedAt,
          },
        }
      : null,
  }
}

async function candidates(db) {
  return (await listAccounts(db))
    .map(migrationCandidate)
    .filter(Boolean)
}

async function buildAiPointV2MigrationPlan(db) {
  const accounts = await listAccounts(db)
  const items = accounts.map(migrationCandidate).filter(Boolean)
  const totals = items.reduce((result, item) => ({
    availableMicroPoints: result.availableMicroPoints + item.nextAccount.availableMicroPoints,
    reservedMicroPoints: result.reservedMicroPoints + item.nextAccount.reservedMicroPoints,
    lifetimeGrantedMicroPoints: result.lifetimeGrantedMicroPoints + item.nextAccount.lifetimeGrantedMicroPoints,
    lifetimeChargedMicroPoints: result.lifetimeChargedMicroPoints + item.nextAccount.lifetimeChargedMicroPoints,
  }), {
    availableMicroPoints: 0,
    reservedMicroPoints: 0,
    lifetimeGrantedMicroPoints: 0,
    lifetimeChargedMicroPoints: 0,
  })
  for (const [field, value] of Object.entries(totals))
    safeInteger(value, `totals.${field}`)
  return {
    schemaVersion: AI_POINT_ACCOUNT_SCHEMA_VERSION,
    scannedAccounts: accounts.length,
    migrationAccounts: items.length,
    activeReservations: items.filter(item => item.reservation).length,
    totals,
  }
}

async function applyAiPointV2Migration(db) {
  const items = await candidates(db)
  let migratedAccounts = 0
  let createdReservations = 0
  for (const item of items) {
    const result = await db.runTransaction(async (transaction) => {
      const accountRef = transaction.collection(AI_POINT_ACCOUNTS_COLLECTION).doc(item.accountId)
      const currentResult = await accountRef.get()
      const current = Array.isArray(currentResult?.data) ? currentResult.data[0] : currentResult?.data
      if (current?.schemaVersion === AI_POINT_ACCOUNT_SCHEMA_VERSION)
        return { migrated: false, reservationCreated: false }
      const latest = migrationCandidate(current)
      if (!latest)
        return { migrated: false, reservationCreated: false }

      let reservationCreated = false
      if (latest.reservation) {
        const reservationRef = transaction
          .collection(AI_POINT_RESERVATIONS_COLLECTION)
          .doc(latest.reservation.id)
        const existingResult = await reservationRef.get()
        const existing = Array.isArray(existingResult?.data) ? existingResult.data[0] : existingResult?.data
        if (existing) {
          if (existing.userId !== latest.reservation.value.userId
            || existing.taskId !== latest.reservation.value.taskId
            || existing.status !== 'active') {
            throw new Error('AI 点数迁移 reservation 冲突')
          }
        }
        else {
          await reservationRef.set(latest.reservation.value)
          reservationCreated = true
        }
      }
      await accountRef.set(latest.nextAccount)
      return { migrated: true, reservationCreated }
    })
    if (result.migrated)
      migratedAccounts += 1
    if (result.reservationCreated)
      createdReservations += 1
  }
  return {
    schemaVersion: AI_POINT_ACCOUNT_SCHEMA_VERSION,
    migratedAccounts,
    createdReservations,
  }
}

module.exports = {
  applyAiPointV2Migration,
  buildAiPointV2MigrationPlan,
}
