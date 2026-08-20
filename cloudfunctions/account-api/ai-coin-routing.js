'use strict'

const {
  handleCommitCoinForAiTask,
  handleReleaseCoinForAiTask,
  handleReleaseExpiredCoinReservations,
  handleReserveCoinForAiTask,
} = require('./internal')

const AI_COIN_INTERNAL_ACTIONS = new Set([
  'commitCoinForAiTask',
  'releaseCoinForAiTask',
  'releaseExpiredCoinReservations',
  'reserveCoinForAiTask',
])

function isAiCoinInternalAction(action) {
  return AI_COIN_INTERNAL_ACTIONS.has(action)
}

async function dispatchAiCoinInternalAction(db, event, options = {}) {
  switch (event?.action) {
    case 'commitCoinForAiTask':
      return handleCommitCoinForAiTask(db, event, options)
    case 'releaseCoinForAiTask':
      return handleReleaseCoinForAiTask(db, event, options)
    case 'releaseExpiredCoinReservations':
      return handleReleaseExpiredCoinReservations(db, event, options)
    case 'reserveCoinForAiTask':
      return handleReserveCoinForAiTask(db, event, options)
    default:
      throw new Error(`未知 AI 云币 action: ${String(event?.action || '')}`)
  }
}

module.exports = {
  AI_COIN_INTERNAL_ACTIONS,
  dispatchAiCoinInternalAction,
  isAiCoinInternalAction,
}
