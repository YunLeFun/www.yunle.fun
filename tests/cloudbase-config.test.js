import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const config = JSON.parse(await readFile(new URL('../cloudbaserc.json', import.meta.url), 'utf8'))
const storageRules = JSON.parse(await readFile(new URL('../storage.rules.json', import.meta.url), 'utf8'))
const functions = new Map(config.functions.map(item => [item.name, item]))
const authCoreSource = await readFile(new URL('../app/composables/auth/useAuthCore.ts', import.meta.url), 'utf8')
const ssoTicketSource = await readFile(new URL('../cloudfunctions/sso-ticket/index.js', import.meta.url), 'utf8')

describe('cloudBase test identity deployment manifest', () => {
  it('keeps the default bucket public-read and server-write only', () => {
    expect(storageRules).toEqual({
      read: 'true',
      write: 'false',
    })
  })

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
      AUTH_ISSUER_ENVIRONMENT: '{{env.AUTH_ISSUER_ENVIRONMENT}}',
      SSO_IDENTITY_SIGNING_KEY: '{{env.SSO_IDENTITY_SIGNING_KEY}}',
      SSO_IDENTITY_SIGNING_KID: '{{env.SSO_IDENTITY_SIGNING_KID}}',
      SSO_IDENTITY_PUBLIC_KEYS: '{{env.SSO_IDENTITY_PUBLIC_KEYS}}',
      SSO_IDENTITY_ASSERTION_TTL_SEC: '{{env.SSO_IDENTITY_ASSERTION_TTL_SEC}}',
      SSO_ISSUE_PER_USER_PER_MINUTE: '{{env.SSO_ISSUE_PER_USER_PER_MINUTE}}',
      SSO_ISSUE_PER_IP_PER_MINUTE: '{{env.SSO_ISSUE_PER_IP_PER_MINUTE}}',
      SSO_EXCHANGE_PER_IP_PER_MINUTE: '{{env.SSO_EXCHANGE_PER_IP_PER_MINUTE}}',
      SSO_EXCHANGE_PER_ORIGIN_PER_MINUTE: '{{env.SSO_EXCHANGE_PER_ORIGIN_PER_MINUTE}}',
      TEST_BROKER_INTERNAL_TOKEN: '{{env.TEST_BROKER_INTERNAL_TOKEN}}',
      TEST_TICKET_ESCROW_KEY: '{{env.TEST_TICKET_ESCROW_KEY}}',
    })
    for (const removed of [
      'SSO_TICKET_INTERNAL_TOKEN',
      'SSO_LOCAL_DEVELOPER_USER_IDS',
      'SSO_ALLOW_PRODUCTION_LOCAL_CLIENTS',
      'SSO_ALLOW_LEGACY_ORIGIN_CLIENTS',
      'SSO_ALLOWED_ORIGINS',
      'SSO_ALLOWED_RETURN_ORIGINS',
      'SSO_ALLOWED_TARGET_ORIGINS',
      'SSO_ALLOW_LEGACY_DIRECT_TICKET',
    ]) {
      expect(functions.get('sso-ticket').envVariables).not.toHaveProperty(removed)
    }
  })

  it('passes an explicit phone verification admission fact into identity assertions', () => {
    expect(ssoTicketSource).toMatch(/resolvePhoneVerificationAdmission/)
    expect(ssoTicketSource).toMatch(/phoneNumberVerified:\s*phoneAdmission\.phoneNumberVerified/)
    expect(ssoTicketSource).not.toMatch(/phoneNumberVerified:\s*true/)
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

  it('runs due account deletion hourly without a public invocation surface', () => {
    expect(functions.get('account-deletion-sweeper')).toMatchObject({
      aclRule: { invoke: false },
      timeout: 30,
      installDependency: true,
      envVariables: { ACCOUNT_API_INTERNAL_TOKEN: '{{env.ACCOUNT_API_INTERNAL_TOKEN}}' },
      triggers: [{ name: 'accountDeletionSweepHourly', type: 'timer', config: '0 30 * * * * *' }],
    })
  })

  it('deploys reward-claim ops without duplicating timer ownership', () => {
    expect(functions.get('reward-claim-ops')).toMatchObject({
      aclRule: { invoke: false },
      timeout: 30,
      installDependency: true,
      envVariables: {
        ACCOUNT_API_INTERNAL_TOKEN: '{{env.ACCOUNT_API_INTERNAL_TOKEN}}',
        REWARD_CLAIM_OPS_WEBHOOK_URL: '{{env.REWARD_CLAIM_OPS_WEBHOOK_URL}}',
        REWARD_CLAIM_ADMIN_URL: 'https://admin.yunle.fun/reward-claims',
      },
    })
    expect(functions.get('reward-claim-ops')).not.toHaveProperty('triggers')
  })

  it('sends lifecycle email from a private five-minute timer with secret placeholders', () => {
    expect(functions.get('account-lifecycle-notifier')).toMatchObject({
      aclRule: { invoke: false },
      timeout: 30,
      installDependency: true,
      envVariables: {
        ACCOUNT_LIFECYCLE_EMAIL_MODE: 'dry_run',
        ACCOUNT_LIFECYCLE_DAILY_USER_LIMIT: '45',
        ACCOUNT_LIFECYCLE_DAILY_OPS_LIMIT: '5',
        SES_REGION: 'ap-guangzhou',
        SES_FROM_EMAIL: 'account@notify.yunle.fun',
        SES_FROM_NAME: '云乐坊账号安全',
        SES_REPLY_TO: 'kf@yunle.fun',
        SES_OPS_EMAIL: 'security@yunle.fun',
        SES_TEMPLATE_DELETION_REQUESTED: '{{env.SES_TEMPLATE_DELETION_REQUESTED}}',
        SES_TEMPLATE_DELETION_REMINDER_7D: '{{env.SES_TEMPLATE_DELETION_REMINDER_7D}}',
        SES_TEMPLATE_DELETION_REMINDER_1D: '{{env.SES_TEMPLATE_DELETION_REMINDER_1D}}',
        SES_TEMPLATE_DELETION_COMPLETED: '{{env.SES_TEMPLATE_DELETION_COMPLETED}}',
        SES_TEMPLATE_DELETION_DELAYED: '{{env.SES_TEMPLATE_DELETION_DELAYED}}',
        SES_TEMPLATE_DELETION_CLEANUP_OPS: '{{env.SES_TEMPLATE_DELETION_CLEANUP_OPS}}',
      },
      triggers: [{ name: 'accountLifecycleNotifyEveryFiveMinutes', type: 'timer', config: '0 */5 * * * * *' }],
    })
  })

  it('requires CloudBase authentication on browser-callable business functions', () => {
    expect(functions.get('sso-ticket').aclRule).toEqual({ invoke: 'auth != null' })
    expect(functions.get('account-api').aclRule).toEqual({ invoke: 'auth != null' })
    expect(functions.get('ai-gateway').aclRule).toEqual({ invoke: 'auth != null' })
  })

  it('publishes identity JWKS and admits a trusted phone fact before minting SSO credentials', () => {
    expect(ssoTicketSource).toContain('event.httpMethod === \'GET\'')
    expect(ssoTicketSource).toContain('identityRuntime.publicJwks()')
    expect(ssoTicketSource).toContain('const phoneAdmission = await resolvePhoneVerificationAdmission({')
    expect(ssoTicketSource.indexOf('const phoneAdmission = await resolvePhoneVerificationAdmission({'))
      .toBeLessThan(ssoTicketSource.indexOf('const ticketResult = mintTicket(uid, testLeaseBinding?.expiresAt)'))
    expect(ssoTicketSource).toContain('createNativeTestSsoLeaseStore(db).resolve({')
    expect(ssoTicketSource.indexOf('createNativeTestSsoLeaseStore(db).resolve({'))
      .toBeLessThan(ssoTicketSource.indexOf('const ticketResult = mintTicket(uid, testLeaseBinding?.expiresAt)'))
  })

  it('configures the private account access token on every restricted business function', () => {
    for (const name of ['ai-gateway', 'desktop-auth', 'github-api', 'iap-order', 'sso-ticket', 'user-storage-api', 'wxpay-order']) {
      expect(functions.get(name)?.envVariables, `${name} 缺少统一账号状态鉴权配置`).toMatchObject({
        ACCOUNT_API_INTERNAL_TOKEN: '{{env.ACCOUNT_API_INTERNAL_TOKEN}}',
      })
    }
    // 支付/退款异步回调不依赖用户登录状态，必须继续完成资金对账。
    expect(functions.get('wxpay-notify')?.envVariables).not.toHaveProperty('ACCOUNT_API_INTERNAL_TOKEN')
    expect(functions.get('appstore-notify')?.envVariables).not.toHaveProperty('ACCOUNT_API_INTERNAL_TOKEN')
  })

  it('does not treat CloudBase anonymous sessions as authenticated users', () => {
    expect(authCoreSource).toContain('isAnonymousSession({ user: rawUser })')
    expect(authCoreSource).toContain('data?.session && !isAnonymousSession(data.session)')
  })

  it('allows the AI gateway enough time for non-streaming structured output', () => {
    expect(functions.get('ai-gateway').timeout).toBe(90)
  })
})
