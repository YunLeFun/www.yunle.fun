import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const config = JSON.parse(await readFile(new URL('../cloudbaserc.json', import.meta.url), 'utf8'))
const functions = new Map(config.functions.map(item => [item.name, item]))
const authCoreSource = await readFile(new URL('../app/composables/auth/useAuthCore.ts', import.meta.url), 'utf8')

describe('cloudBase test identity deployment manifest', () => {
  it('versions every private test-identity environment variable as a placeholder', () => {
    expect(functions.get('account-api').envVariables).toMatchObject({
      AI_GATEWAY_ACCOUNT_API_TOKEN: '{{env.AI_GATEWAY_ACCOUNT_API_TOKEN}}',
      TEST_BROKER_ACCOUNT_API_TOKEN: '{{env.TEST_BROKER_ACCOUNT_API_TOKEN}}',
    })
    expect(functions.get('ai-gateway').envVariables).toMatchObject({
      AI_GATEWAY_ACCOUNT_API_TOKEN: '{{env.AI_GATEWAY_ACCOUNT_API_TOKEN}}',
      TEST_BROKER_RECONCILE_TOKEN: '{{env.TEST_BROKER_RECONCILE_TOKEN}}',
      TEST_LEASE_CAPABILITY_SIGNING_KEY: '{{env.TEST_LEASE_CAPABILITY_SIGNING_KEY}}',
    })
    expect(functions.get('sso-ticket').envVariables).toMatchObject({
      SSO_ALLOWED_ORIGINS: '{{env.SSO_ALLOWED_ORIGINS}}',
      SSO_ALLOWED_RETURN_ORIGINS: '{{env.SSO_ALLOWED_RETURN_ORIGINS}}',
      SSO_ALLOWED_TARGET_ORIGINS: '{{env.SSO_ALLOWED_TARGET_ORIGINS}}',
      SSO_ALLOW_LOCAL_TARGET_ORIGINS: '{{env.SSO_ALLOW_LOCAL_TARGET_ORIGINS}}',
      SSO_ALLOW_LEGACY_DIRECT_TICKET: '{{env.SSO_ALLOW_LEGACY_DIRECT_TICKET}}',
      SSO_ISSUE_PER_USER_PER_MINUTE: '{{env.SSO_ISSUE_PER_USER_PER_MINUTE}}',
      SSO_ISSUE_PER_IP_PER_MINUTE: '{{env.SSO_ISSUE_PER_IP_PER_MINUTE}}',
      SSO_EXCHANGE_PER_IP_PER_MINUTE: '{{env.SSO_EXCHANGE_PER_IP_PER_MINUTE}}',
      SSO_EXCHANGE_PER_ORIGIN_PER_MINUTE: '{{env.SSO_EXCHANGE_PER_ORIGIN_PER_MINUTE}}',
      TEST_BROKER_INTERNAL_TOKEN: '{{env.TEST_BROKER_INTERNAL_TOKEN}}',
      TEST_TICKET_ESCROW_KEY: '{{env.TEST_TICKET_ESCROW_KEY}}',
    })
    expect(functions.get('sso-ticket').envVariables).not.toHaveProperty('SSO_TICKET_INTERNAL_TOKEN')
  })

  it('runs the HMAC-authenticated sweep every minute', () => {
    expect(functions.get('test-identity-sweeper')).toMatchObject({
      aclRule: { invoke: false },
      timeout: 30,
      envVariables: { TEST_BROKER_SWEEP_KEY: '{{env.TEST_BROKER_SWEEP_KEY}}' },
      triggers: [{ name: 'testIdentitySweepEveryMinute', type: 'timer', config: '0 * * * * * *' }],
    })
  })

  it('runs SSO security cleanup hourly without a public invocation surface', () => {
    expect(functions.get('sso-security-sweeper')).toMatchObject({
      aclRule: { invoke: false },
      timeout: 30,
      installDependency: true,
      triggers: [{ name: 'ssoSecuritySweepHourly', type: 'timer', config: '0 0 * * * * *' }],
    })
  })

  it('runs shared session expiry and retention cleanup without a public invocation surface', () => {
    expect(functions.get('session-security-sweeper')).toMatchObject({
      aclRule: { invoke: false },
      timeout: 30,
      installDependency: true,
      triggers: [{ name: 'sessionSecuritySweepHourly', type: 'timer', config: '0 15 * * * * *' }],
    })
  })

  it('requires CloudBase authentication on browser-callable business functions', () => {
    expect(functions.get('sso-ticket').aclRule).toEqual({ invoke: 'auth != null' })
    expect(functions.get('account-api').aclRule).toEqual({ invoke: 'auth != null' })
    expect(functions.get('ai-gateway').aclRule).toEqual({ invoke: 'auth != null' })
  })

  it('does not treat CloudBase anonymous sessions as authenticated users', () => {
    expect(authCoreSource).toContain('isAnonymousSession({ user: rawUser })')
    expect(authCoreSource).toContain('data?.session && !isAnonymousSession(data.session)')
  })

  it('allows the AI gateway enough time for non-streaming structured output', () => {
    expect(functions.get('ai-gateway').timeout).toBe(90)
  })
})
