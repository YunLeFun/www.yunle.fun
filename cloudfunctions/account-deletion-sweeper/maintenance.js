/** 将账号封禁到期维护与注销清理编排在同一定时任务中，故障彼此隔离。 */

'use strict'

async function runAccountMaintenance({ expireRestrictions, sweepDeletions }) {
  let restrictions
  try {
    restrictions = { ok: true, ...(await expireRestrictions()) }
  }
  catch (error) {
    console.error('[account-maintenance] expire restrictions failed', error)
    restrictions = { ok: false, error: error?.name || 'Error' }
  }

  const deletions = await sweepDeletions()
  return { restrictions, deletions }
}

module.exports = { runAccountMaintenance }
