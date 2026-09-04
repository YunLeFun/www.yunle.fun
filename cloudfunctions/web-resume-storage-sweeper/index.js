/** Private timer bridge for Web Resume's 30-day trash purge. */

'use strict'

const { Buffer } = require('node:buffer')
const process = require('node:process')

const SWEEP_LIMIT = 20

async function runWebResumeStorageSweep(app, serviceToken) {
  if (!serviceToken || Buffer.byteLength(serviceToken, 'utf8') < 32)
    throw new Error('WEB_RESUME_SWEEPER_INTERNAL_TOKEN must be at least 32 bytes')
  const response = await app.callFunction({
    name: 'user-storage-api',
    data: {
      action: 'sweepWebResumeTrash',
      limit: SWEEP_LIMIT,
      serviceToken,
    },
  })
  const result = response?.result
  if (
    !result
    || result.ok !== true
    || !['scanned', 'purged', 'deferred', 'errors'].every(key => Number.isSafeInteger(result[key]) && result[key] >= 0)
  ) {
    throw new Error('Web Resume storage sweep returned invalid data')
  }
  return result
}

exports.main = async function main() {
  const cloudbase = require('@cloudbase/node-sdk')
  const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV })
  const result = await runWebResumeStorageSweep(app, process.env.WEB_RESUME_SWEEPER_INTERNAL_TOKEN || '')
  console.warn('[web-resume-storage-sweeper] completed', JSON.stringify(result))
  return result
}

exports.SWEEP_LIMIT = SWEEP_LIMIT
exports.runWebResumeStorageSweep = runWebResumeStorageSweep
