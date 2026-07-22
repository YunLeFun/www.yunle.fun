/** Deep Module for versioned SSO client authorization decisions. */

'use strict'

const CLIENT_ID_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/
const ISSUER_ENVIRONMENTS = new Set(['production', 'development'])
const CLIENT_ENVIRONMENTS = new Set(['production', 'local', 'preview'])
const ACCESS_POLICIES = new Set(['authenticated', 'developer'])

class SsoClientRegistryError extends Error {
  constructor(reason, message) {
    super(message)
    this.name = 'SsoClientRegistryError'
    this.reason = reason
  }
}

function canonicalHttpsOrigin(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:'
      && !url.username
      && !url.password
      && !url.hostname.endsWith('.')
      && url.origin === value
      ? url.origin
      : ''
  }
  catch {
    return ''
  }
}

function canonicalRedirectUri(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.hostname.endsWith('.'))
      return ''
    return url.toString() === value ? value : ''
  }
  catch {
    return ''
  }
}

function readDeveloperUserIds(raw) {
  if (typeof raw !== 'string')
    return []
  return [...new Set(raw.split(',').map(value => value.trim()).filter(Boolean))]
}

function normalizeSnapshot(snapshot) {
  if (!snapshot || snapshot.schemaVersion !== 1 || typeof snapshot.policyVersion !== 'string' || !snapshot.policyVersion)
    throw new SsoClientRegistryError('registry_invalid', 'invalid SSO client registry metadata')
  if (!Array.isArray(snapshot.clients))
    throw new SsoClientRegistryError('registry_invalid', 'SSO client registry clients must be an array')

  const clients = new Map()
  const registrationsByOrigin = new Map()
  for (const rawClient of snapshot.clients) {
    if (!rawClient || !CLIENT_ID_RE.test(rawClient.clientId || '') || !['active', 'disabled'].includes(rawClient.status))
      throw new SsoClientRegistryError('registry_invalid', 'invalid SSO client registration')
    if (clients.has(rawClient.clientId))
      throw new SsoClientRegistryError('registry_invalid', `duplicate SSO client ${rawClient.clientId}`)
    if (!Array.isArray(rawClient.registrations) || rawClient.registrations.length === 0)
      throw new SsoClientRegistryError('registry_invalid', `SSO client ${rawClient.clientId} has no registrations`)

    const client = { clientId: rawClient.clientId, status: rawClient.status, registrations: [] }
    const ruleIds = new Set()
    for (const rawRule of rawClient.registrations) {
      const origin = canonicalHttpsOrigin(rawRule?.origin)
      const issuerEnvironments = Array.isArray(rawRule?.issuerEnvironments) ? [...new Set(rawRule.issuerEnvironments)] : []
      const redirectUris = Array.isArray(rawRule?.redirectUris) ? [...new Set(rawRule.redirectUris)] : []
      if (!rawRule
        || typeof rawRule.ruleId !== 'string'
        || !rawRule.ruleId
        || ruleIds.has(rawRule.ruleId)
        || !origin
        || !issuerEnvironments.length
        || issuerEnvironments.some(value => !ISSUER_ENVIRONMENTS.has(value))
        || !CLIENT_ENVIRONMENTS.has(rawRule.clientEnvironment)
        || !ACCESS_POLICIES.has(rawRule.access)
        || !redirectUris.length
        || redirectUris.some(value => !canonicalRedirectUri(value) || new URL(value).origin !== origin)) {
        throw new SsoClientRegistryError('registry_invalid', `invalid registration for SSO client ${rawClient.clientId}`)
      }
      ruleIds.add(rawRule.ruleId)
      const rule = {
        ruleId: rawRule.ruleId,
        issuerEnvironments,
        clientEnvironment: rawRule.clientEnvironment,
        origin,
        redirectUris,
        access: rawRule.access,
      }
      client.registrations.push(rule)
      for (const issuerEnvironment of issuerEnvironments) {
        const key = `${issuerEnvironment}\0${origin}`
        if (registrationsByOrigin.has(key))
          throw new SsoClientRegistryError('registry_invalid', `duplicate SSO origin ${origin}`)
        registrationsByOrigin.set(key, { client, rule })
      }
    }
    clients.set(client.clientId, client)
  }
  return { policyVersion: snapshot.policyVersion, clients, registrationsByOrigin }
}

/**
 * Create the registry Module. Callers learn one Interface: authorize(). URL parsing,
 * conflict detection, environment isolation and developer gating stay behind the seam.
 */
function createSsoClientRegistry(snapshot, options = {}) {
  const issuerEnvironment = ISSUER_ENVIRONMENTS.has(options.issuerEnvironment)
    ? options.issuerEnvironment
    : 'production'
  const developerUserIds = new Set(readDeveloperUserIds(options.developerUserIds))
  const allowProductionLocalClients = options.allowProductionLocalClients === true
  const normalized = normalizeSnapshot(snapshot)

  return {
    authorize(input) {
      const origin = canonicalHttpsOrigin(input?.origin)
      if (!origin)
        throw new SsoClientRegistryError('origin_not_allowed', 'SSO origin must be an exact HTTPS origin')
      const clientId = typeof input?.clientId === 'string' ? input.clientId : ''
      if (clientId && !CLIENT_ID_RE.test(clientId))
        throw new SsoClientRegistryError('client_unknown', 'invalid SSO client identifier')

      let resolved
      if (clientId) {
        const client = normalized.clients.get(clientId)
        if (!client)
          throw new SsoClientRegistryError('client_unknown', 'unknown SSO client')
        if (client.status !== 'active')
          throw new SsoClientRegistryError('client_disabled', 'SSO client is disabled')
        const rule = client.registrations.find(candidate => candidate.origin === origin && candidate.issuerEnvironments.includes(issuerEnvironment))
        if (!rule)
          throw new SsoClientRegistryError('origin_not_allowed', 'origin is not registered for this SSO client and issuer')
        resolved = { client, rule }
      }
      else {
        resolved = normalized.registrationsByOrigin.get(`${issuerEnvironment}\0${origin}`)
        if (!resolved)
          throw new SsoClientRegistryError('client_unknown', 'origin does not resolve to a registered SSO client')
        if (resolved.client.status !== 'active')
          throw new SsoClientRegistryError('client_disabled', 'SSO client is disabled')
      }

      const { client, rule } = resolved
      if (rule.clientEnvironment === 'local' && issuerEnvironment === 'production' && !allowProductionLocalClients)
        throw new SsoClientRegistryError('environment_mismatch', 'production issuer does not allow local clients')
      if (input?.returnUrl && !rule.redirectUris.includes(input.returnUrl))
        throw new SsoClientRegistryError('return_url_not_allowed', 'redirect URI is not registered exactly')
      if (input?.phase === 'issue' && rule.access === 'developer' && !developerUserIds.has(input.actorUid))
        throw new SsoClientRegistryError('developer_required', 'registered developer account is required')

      return Object.freeze({
        clientId: client.clientId,
        issuerEnvironment,
        clientEnvironment: rule.clientEnvironment,
        origin,
        policyVersion: normalized.policyVersion,
        ruleId: rule.ruleId,
      })
    },
  }
}

module.exports = {
  CLIENT_ID_RE,
  SsoClientRegistryError,
  canonicalHttpsOrigin,
  canonicalRedirectUri,
  createSsoClientRegistry,
  readDeveloperUserIds,
}
