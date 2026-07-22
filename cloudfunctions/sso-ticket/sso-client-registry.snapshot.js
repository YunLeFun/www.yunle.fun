/**
 * Versioned first-party SSO client registrations.
 *
 * This file is policy-as-code: changes require review and deployment. It contains no
 * credentials. A future Admin publisher may replace the snapshot adapter without
 * changing the registry Interface consumed by sso-ticket.
 */

'use strict'

module.exports = Object.freeze({
  schemaVersion: 1,
  policyVersion: '2026-07-22.1',
  clients: Object.freeze([
    Object.freeze({
      clientId: 'cms-web',
      status: 'active',
      registrations: Object.freeze([
        Object.freeze({
          ruleId: 'cms-production',
          issuerEnvironments: Object.freeze(['production']),
          clientEnvironment: 'production',
          origin: 'https://cms.yunle.fun',
          redirectUris: Object.freeze(['https://cms.yunle.fun/']),
          access: 'authenticated',
        }),
        Object.freeze({
          ruleId: 'cms-managed-local',
          issuerEnvironments: Object.freeze(['production', 'development']),
          clientEnvironment: 'local',
          origin: 'https://cms.yunle.localhost:3443',
          redirectUris: Object.freeze(['https://cms.yunle.localhost:3443/']),
          access: 'developer',
        }),
      ]),
    }),
  ]),
})
