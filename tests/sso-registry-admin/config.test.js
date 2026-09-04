import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { SSO_REGISTRY_COLLECTION_MANIFESTS } from '../../cloudfunctions/sso-registry-admin/store.js'

const root = resolve(import.meta.dirname, '../..')

function config(name) {
  return JSON.parse(readFileSync(resolve(root, name), 'utf8'))
}

describe('sso-registry-admin deployment contract', () => {
  it.each([
    ['cloudbaserc.json', 'production'],
    ['cloudbaserc.sso-development.json', 'development'],
  ])('declares a private Node 18 Event Function in %s', (file, expectedEnvironment) => {
    const manifest = config(file)
    const fn = manifest.functions.find(candidate => candidate.name === 'sso-registry-admin')
    expect(fn).toMatchObject({
      runtime: 'Nodejs18.15',
      handler: 'index.main',
      installDependency: true,
      aclRule: { invoke: false },
      envVariables: {
        SSO_REGISTRY_SIGNING_KEY: '{{env.SSO_REGISTRY_SIGNING_KEY}}',
        SSO_REGISTRY_SIGNING_KID: '{{env.SSO_REGISTRY_SIGNING_KID}}',
      },
    })
    if (expectedEnvironment === 'production') {
      expect(fn.triggers).toEqual([expect.objectContaining({
        name: 'ssoRegistryApprovalDecision',
        type: 'timer',
      })])
    }
    else {
      expect(fn.triggers).toBeUndefined()
    }
    expect(fn.envVariables.AUTH_ISSUER_ENVIRONMENT).toBe(
      expectedEnvironment === 'development'
        ? 'development'
        : '{{env.AUTH_ISSUER_ENVIRONMENT}}',
    )
    expect(fn.envVariables.SSO_REGISTRY_CI_TOKEN).toBe('{{env.SSO_REGISTRY_CI_TOKEN}}')
    if (expectedEnvironment === 'production') {
      expect(fn.envVariables).toMatchObject({
        SES_TEMPLATE_REGISTRY_APPROVAL: '{{env.SES_TEMPLATE_REGISTRY_APPROVAL}}',
        SSO_REGISTRY_APPROVAL_PEPPER: '{{env.SSO_REGISTRY_APPROVAL_PEPPER}}',
        SSO_REGISTRY_ADMIN_BASE_URL: 'https://admin.yunle.fun',
        SSO_REGISTRY_ADMIN_CHANNEL_SECRET: '{{env.SSO_REGISTRY_ADMIN_CHANNEL_SECRET}}',
        SSO_REGISTRY_ADMIN_DECISION_PUBLIC_KEYS: '{{env.SSO_REGISTRY_ADMIN_DECISION_PUBLIC_KEYS}}',
        SSO_REGISTRY_APPROVER_UIDS: '{{env.SSO_REGISTRY_APPROVER_UIDS}}',
        SSO_REGISTRY_FEISHU_APPROVAL_ENABLED: 'false',
      })
    }
  })

  it.each(['cloudbaserc.json', 'cloudbaserc.sso-development.json'])(
    'declares a private timer release dispatcher in %s',
    (file) => {
      const manifest = config(file)
      const fn = manifest.functions.find(candidate => candidate.name === 'sso-registry-release-dispatcher')
      expect(fn).toMatchObject({
        runtime: 'Nodejs18.15',
        handler: 'index.main',
        aclRule: { invoke: false },
        envVariables: {
          SSO_REGISTRY_GITHUB_APP_ID: '{{env.SSO_REGISTRY_GITHUB_APP_ID}}',
          SSO_REGISTRY_GITHUB_APP_INSTALLATION_ID: '{{env.SSO_REGISTRY_GITHUB_APP_INSTALLATION_ID}}',
          SSO_REGISTRY_GITHUB_APP_PRIVATE_KEY: '{{env.SSO_REGISTRY_GITHUB_APP_PRIVATE_KEY}}',
        },
      })
      expect(fn.triggers).toEqual([expect.objectContaining({ type: 'timer' })])
    },
  )

  it('keeps Registry shadow database reads outside authorization request runtimes', () => {
    const production = config('cloudbaserc.json')
    for (const name of ['desktop-auth', 'sso-ticket']) {
      expect(
        production.functions.find(fn => fn.name === name)?.envVariables,
      ).not.toHaveProperty('SSO_REGISTRY_SHADOW_ENABLED')
    }
    const development = config('cloudbaserc.sso-development.json')
    expect(
      development.functions.find(fn => fn.name === 'sso-ticket')?.envVariables,
    ).not.toHaveProperty('SSO_REGISTRY_SHADOW_ENABLED')
  })

  it('declares the P1 and P1.1 ADMINONLY collections with required indexes', () => {
    expect(SSO_REGISTRY_COLLECTION_MANIFESTS.map(item => item.collection)).toEqual([
      'sso_registry_drafts',
      'sso_registry_snapshots',
      'sso_registry_state',
      'sso_registry_audit_logs',
      'sso_registry_publish_approvals',
      'sso_registry_release_intents',
      'sso_registry_release_outbox',
    ])
    expect(SSO_REGISTRY_COLLECTION_MANIFESTS.every(item => item.access === 'ADMINONLY')).toBe(true)
    const snapshots = SSO_REGISTRY_COLLECTION_MANIFESTS.find(item => item.collection === 'sso_registry_snapshots')
    expect(snapshots.indexes).toContainEqual(expect.objectContaining({
      name: 'environment_sequence',
      unique: true,
    }))
    expect(SSO_REGISTRY_COLLECTION_MANIFESTS.find(item => item.collection === 'sso_registry_publish_approvals')?.indexes)
      .toContainEqual(expect.objectContaining({ name: 'environment_status_expires' }))
    expect(SSO_REGISTRY_COLLECTION_MANIFESTS.find(item => item.collection === 'sso_registry_publish_approvals')?.indexes)
      .toContainEqual(expect.objectContaining({ name: 'environment_status_updated' }))
    expect(SSO_REGISTRY_COLLECTION_MANIFESTS.find(item => item.collection === 'sso_registry_publish_approvals')?.indexes)
      .toContainEqual(expect.objectContaining({ name: 'environment_card_sync_next' }))
    expect(SSO_REGISTRY_COLLECTION_MANIFESTS.find(item => item.collection === 'sso_registry_release_outbox')?.indexes)
      .toContainEqual(expect.objectContaining({ name: 'status_next_attempt' }))
    expect(SSO_REGISTRY_COLLECTION_MANIFESTS.find(item => item.collection === 'sso_registry_release_outbox')?.indexes)
      .toContainEqual(expect.objectContaining({ name: 'status_lease_expiry' }))
  })
})
