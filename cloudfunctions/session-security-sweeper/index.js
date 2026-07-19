/** Expire inactive application sessions and purge terminal records after the retention window. */

'use strict'

const TERMINAL_RETENTION_MS = 90 * 24 * 60 * 60 * 1000
const SWEEP_LIMIT = 250

async function runSessionSweep(sweeper, now = Date.now()) {
  if (!sweeper || typeof sweeper.sweepExpired !== 'function' || typeof sweeper.sweepTerminal !== 'function')
    throw new TypeError('a CloudBase session sweeper is required')
  if (!Number.isSafeInteger(now))
    throw new TypeError('sweep time must be an integer timestamp')
  const expired = await sweeper.sweepExpired({ now, limit: SWEEP_LIMIT })
  const terminal = await sweeper.sweepTerminal({ now, retentionMs: TERMINAL_RETENTION_MS, limit: SWEEP_LIMIT })
  return { ok: true, expired, terminal }
}

exports.main = async function main() {
  const cloudbase = require('@cloudbase/node-sdk')
  const { CloudBaseSessionSweeper } = require('@yunlefun/server-session-cloudbase')
  const database = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV }).database()
  const result = await runSessionSweep(new CloudBaseSessionSweeper({ database }))
  console.warn('[session-security-sweeper] completed', JSON.stringify(result))
  return result
}

exports.SWEEP_LIMIT = SWEEP_LIMIT
exports.TERMINAL_RETENTION_MS = TERMINAL_RETENTION_MS
exports.runSessionSweep = runSessionSweep
