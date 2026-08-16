'use strict'

const {
  handleAdjustAiPointsForUser,
  handleGetAiPointAccountForUser,
  handleGrantAiPointsForUser,
  handleListAiPointTransactionsForUser,
  handleRefundAiPointsForTask,
  handleReleaseAiPointsForTask,
  handleReserveAiPointsForTask,
  handleSettleAiPointsForTask,
} = require('./internal')

const AI_POINT_INTERNAL_ACTIONS = new Set([
  'adjustAiPointsForUser',
  'getAiPointAccountForUser',
  'grantAiPointsForUser',
  'listAiPointTransactionsForUser',
  'refundAiPointsForTask',
  'releaseAiPointsForTask',
  'reserveAiPointsForTask',
  'settleAiPointsForTask',
])

function isAiPointInternalAction(action) {
  return AI_POINT_INTERNAL_ACTIONS.has(action)
}

async function dispatchAiPointInternalAction(db, event, options = {}) {
  switch (event?.action) {
    case 'adjustAiPointsForUser':
      return handleAdjustAiPointsForUser(db, event, options)
    case 'getAiPointAccountForUser':
      return handleGetAiPointAccountForUser(db, event, options)
    case 'grantAiPointsForUser':
      return handleGrantAiPointsForUser(db, event, options)
    case 'listAiPointTransactionsForUser':
      return handleListAiPointTransactionsForUser(db, event, options)
    case 'refundAiPointsForTask':
      return handleRefundAiPointsForTask(db, event, options)
    case 'releaseAiPointsForTask':
      return handleReleaseAiPointsForTask(db, event, options)
    case 'reserveAiPointsForTask':
      return handleReserveAiPointsForTask(db, event, options)
    case 'settleAiPointsForTask':
      return handleSettleAiPointsForTask(db, event, options)
    default:
      throw new Error(`未知 AI 点数 action: ${String(event?.action || '')}`)
  }
}

module.exports = {
  AI_POINT_INTERNAL_ACTIONS,
  dispatchAiPointInternalAction,
  isAiPointInternalAction,
}
