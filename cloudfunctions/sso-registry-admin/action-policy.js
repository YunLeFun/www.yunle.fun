/** Public action boundary for the private Registry management function. */

'use strict'

const { Buffer } = require('node:buffer')
const { timingSafeEqual } = require('node:crypto')

const { RegistryAdminError } = require('./service')

const DIRECT_RELEASE_ACTIONS = new Set(['publishDraft', 'rollback'])
const CI_ACTIONS = new Set(['getReleaseIntent', 'recordCiProgress', 'recordDeploymentResult'])
const TIMER_ACTIONS = new Set(['processPendingAdminApprovalDecisions'])

function secureTokenEqual(first, second) {
  const left = Buffer.from(String(first || ''))
  const right = Buffer.from(String(second || ''))
  return left.length >= 32 && left.length === right.length && timingSafeEqual(left, right)
}

function assertRegistryAdminActionAllowed(action, environment, options = {}) {
  if (environment === 'production' && DIRECT_RELEASE_ACTIONS.has(action))
    throw new RegistryAdminError('release_approval_required')
  if (CI_ACTIONS.has(action) && !secureTokenEqual(options.ciToken, options.expectedCiToken))
    throw new RegistryAdminError('ci_identity_required')
  if (TIMER_ACTIONS.has(action) && options.timerTrigger !== true)
    throw new RegistryAdminError('timer_identity_required')
}

module.exports = { assertRegistryAdminActionAllowed }
