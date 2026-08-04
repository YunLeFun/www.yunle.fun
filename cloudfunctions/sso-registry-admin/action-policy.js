/** Public action boundary for the private Registry management function. */

'use strict'

const { RegistryAdminError } = require('./service')

const DIRECT_RELEASE_ACTIONS = new Set(['publishDraft', 'rollback'])

function assertRegistryAdminActionAllowed(action, environment) {
  if (environment === 'production' && DIRECT_RELEASE_ACTIONS.has(action))
    throw new RegistryAdminError('release_approval_required')
}

module.exports = { assertRegistryAdminActionAllowed }
