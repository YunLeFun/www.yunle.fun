import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const packageManifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const deployment = JSON.parse(readFileSync(new URL('../cloudbaserc.sso-development.json', import.meta.url), 'utf8'))
const gateway = readFileSync(new URL('../dev/Caddyfile', import.meta.url), 'utf8')
const launcher = readFileSync(new URL('../scripts/dev-sso-provider.mjs', import.meta.url), 'utf8')
const deployer = readFileSync(new URL('../scripts/deploy-sso-development.mjs', import.meta.url), 'utf8')

describe('local SSO Provider entrypoint', () => {
  it('runs the existing Provider against the isolated development tenant', () => {
    expect(packageManifest.scripts['dev:sso']).toBe('node scripts/dev-sso-provider.mjs')
    expect(launcher).toContain('const providerOrigin = \'https://www.yunle.localhost:3000\'')
    expect(launcher).toContain('const developmentCloudbaseEnvId = \'yunlefun-dev-0ge03bdod37093d1\'')
    expect(launcher).toContain('NUXT_PUBLIC_SITE_URL: providerOrigin')
    expect(launcher).toContain('NUXT_PUBLIC_CLOUDBASE_ENV_ID: process.env.NUXT_PUBLIC_CLOUDBASE_ENV_ID ?? developmentCloudbaseEnvId')
  })

  it('keeps the public issuer stable while proxying to loopback Nuxt', () => {
    expect(gateway).toContain('https://www.yunle.localhost:3000')
    expect(gateway).toContain('tls internal')
    expect(gateway).toContain('reverse_proxy {$YUNLE_PROVIDER_UPSTREAM:127.0.0.1:3001}')
    expect(gateway).toContain('skip_install_trust')
    expect(launcher).toContain('const upstreamPort = await selectUpstreamPort()')
    expect(launcher).toContain('YUNLE_PROVIDER_UPSTREAM: upstream')
  })

  it('pins development deployments away from the production tenant', () => {
    expect(packageManifest.scripts['deploy:sso:development']).toBe('node scripts/deploy-sso-development.mjs')
    expect(deployment.envId).toBe('yunlefun-dev-0ge03bdod37093d1')
    expect(deployment.functions.map(item => item.name)).toEqual([
      'sso-registry-admin',
      'sso-registry-release-dispatcher',
      'account-api',
      'sso-ticket',
      'sso-security-sweeper',
    ])
    const ticket = deployment.functions.find(item => item.name === 'sso-ticket')
    expect(ticket).toMatchObject({
      aclRule: { invoke: true },
    })
    expect(ticket.envVariables).toMatchObject({
      SSO_TICKET_PRIVATE_KEY_ID: '{{env.SSO_TICKET_PRIVATE_KEY_ID}}',
      SSO_TICKET_PRIVATE_KEY: '{{env.SSO_TICKET_PRIVATE_KEY}}',
      AUTH_ISSUER_ENVIRONMENT: 'development',
      ACCOUNT_API_INTERNAL_TOKEN: '{{env.ACCOUNT_API_INTERNAL_TOKEN}}',
    })
    expect(deployer).toContain('if (config.envId !== DEVELOPMENT_ENV_ID)')
    expect(deployer).toContain('\'.env.sso-development.local\'')
    expect(deployer).toContain('runTcb([\'fn\', \'deploy\', \'sso-registry-admin\', \'--dir\', registryArtifact, \'--force\'])')
    expect(deployer).toContain('runTcb([\'config\', \'update\', \'fn\', name])')
  })
})
