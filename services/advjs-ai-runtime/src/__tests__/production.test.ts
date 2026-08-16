import { describe, expect, it } from 'vitest'
import { StaticBearerServiceAuthVerifier } from '../auth/service-bearer.js'
import { loadProductionRuntimeConfig } from '../production/config.js'

const ADMIN_TOKEN = 'runtime-admin-token-fixture-000000000001'
const ACCOUNT_TOKEN = 'account-api-token-fixture-000000000001'

describe('production runtime configuration', () => {
  it('loads an explicit canonical environment and exact HTTPS origins', () => {
    expect(loadProductionRuntimeConfig({
      ADVJS_AI_ACCOUNT_API_TOKEN: ACCOUNT_TOKEN,
      ADVJS_AI_ADMIN_TOKEN: ADMIN_TOKEN,
      ADVJS_AI_ALLOWED_ORIGINS: 'https://studio.advjs.org,https://studio-staging.advjs.org',
      ADVJS_AI_CLOUDBASE_ENV_ID: 'yunlefun-test-123456',
    })).toMatchObject({
      accountApiToken: ACCOUNT_TOKEN,
      adminToken: ADMIN_TOKEN,
      allowedOrigins: ['https://studio.advjs.org', 'https://studio-staging.advjs.org'],
      billingAppId: 'advjs-studio',
      clientAppId: 'advjs-studio-web',
      envId: 'yunlefun-test-123456',
      scope: 'studio-managed-ai',
    })
  })

  it('fails closed for implicit envs, wildcard origins, weak tokens or credential reuse', () => {
    const base = {
      ADVJS_AI_ACCOUNT_API_TOKEN: ACCOUNT_TOKEN,
      ADVJS_AI_ADMIN_TOKEN: ADMIN_TOKEN,
      ADVJS_AI_ALLOWED_ORIGINS: 'https://studio.advjs.org',
      ADVJS_AI_CLOUDBASE_ENV_ID: 'yunlefun-test-123456',
    }
    expect(() => loadProductionRuntimeConfig({ ...base, ADVJS_AI_CLOUDBASE_ENV_ID: '' })).toThrowError(/required/i)
    expect(() => loadProductionRuntimeConfig({ ...base, ADVJS_AI_ALLOWED_ORIGINS: '*' })).toThrowError(/origin/i)
    expect(() => loadProductionRuntimeConfig({ ...base, ADVJS_AI_ADMIN_TOKEN: 'short' })).toThrowError(/credential/i)
    expect(() => loadProductionRuntimeConfig({ ...base, ADVJS_AI_ACCOUNT_API_TOKEN: ADMIN_TOKEN })).toThrowError(/separate/i)
  })
})

describe('production admin service authentication', () => {
  it('accepts only the exact bearer credential and audience', async () => {
    const verifier = new StaticBearerServiceAuthVerifier({
      actor: 'yunlefun-admin',
      audience: 'advjs-ai-runtime-admin',
      token: ADMIN_TOKEN,
    })

    await expect(verifier.verify(`Bearer ${ADMIN_TOKEN}`, 'advjs-ai-runtime-admin')).resolves.toEqual({
      actor: 'yunlefun-admin',
    })
    await expect(verifier.verify(`Service ${ADMIN_TOKEN}`, 'advjs-ai-runtime-admin')).rejects.toThrowError(/authentication/i)
    await expect(verifier.verify('Bearer wrong-token', 'advjs-ai-runtime-admin')).rejects.toThrowError(/authentication/i)
    await expect(verifier.verify(`Bearer ${ADMIN_TOKEN}`, 'other-audience')).rejects.toThrowError(/authentication/i)
  })
})
