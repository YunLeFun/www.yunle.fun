import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import {
  assertFunctionEnvironmentReady,
  createCloudBaseConfigEnvironment,
  requiredEnvironmentNames,
} from '../scripts/deploy-function-safety.mjs'

const config = {
  functions: [
    {
      name: 'account-api',
      envVariables: {
        ACCOUNT_API_INTERNAL_TOKEN: '{{env.ACCOUNT_API_INTERNAL_TOKEN}}',
        REWARD_CLAIM_LINK_HASH_KEY: '{{env.REWARD_CLAIM_LINK_HASH_KEY}}',
        REWARD_CLAIM_RATE_TICKET_SECRET: '{{env.REWARD_CLAIM_RATE_TICKET_SECRET}}',
        REWARD_CLAIM_SITE_URL: 'https://www.yunle.fun',
      },
    },
  ],
}

const productionConfig = JSON.parse(await readFile(new URL('../cloudbaserc.json', import.meta.url), 'utf8'))
const ciConfig = JSON.parse(await readFile(new URL('../cloudbaserc.ci.json', import.meta.url), 'utf8'))
const envExample = await readFile(new URL('../.env.example', import.meta.url), 'utf8')
const TEST_IDENTITY_FUNCTIONS = [
  'account-api',
  'ai-gateway',
  'sso-ticket',
  'test-identity-sweeper',
]

describe('云函数部署环境变量门禁', () => {
  it('只收集待部署函数使用的环境占位符', () => {
    expect(requiredEnvironmentNames(config, ['account-api'])).toEqual([
      'ACCOUNT_API_INTERNAL_TOKEN',
      'REWARD_CLAIM_LINK_HASH_KEY',
      'REWARD_CLAIM_RATE_TICKET_SECRET',
    ])
  })

  it('缺少占位符对应变量时拒绝部署', () => {
    expect(() => assertFunctionEnvironmentReady(config, ['account-api'], {
      ACCOUNT_API_INTERNAL_TOKEN: 'a'.repeat(64),
    })).toThrow('REWARD_CLAIM_LINK_HASH_KEY, REWARD_CLAIM_RATE_TICKET_SECRET')

    expect(() => assertFunctionEnvironmentReady(config, ['account-api'], {
      ACCOUNT_API_INTERNAL_TOKEN: 'a'.repeat(64),
      REWARD_CLAIM_LINK_HASH_KEY: '   ',
      REWARD_CLAIM_RATE_TICKET_SECRET: 'b'.repeat(64),
    })).toThrow('REWARD_CLAIM_LINK_HASH_KEY')
  })

  it('领取密钥过短或复用时拒绝部署', () => {
    expect(() => assertFunctionEnvironmentReady(config, ['account-api'], {
      ACCOUNT_API_INTERNAL_TOKEN: 'a'.repeat(64),
      REWARD_CLAIM_LINK_HASH_KEY: 'short',
      REWARD_CLAIM_RATE_TICKET_SECRET: 'b'.repeat(64),
    })).toThrow('至少 32 字节')

    expect(() => assertFunctionEnvironmentReady(config, ['account-api'], {
      ACCOUNT_API_INTERNAL_TOKEN: 'a'.repeat(64),
      REWARD_CLAIM_LINK_HASH_KEY: 'c'.repeat(64),
      REWARD_CLAIM_RATE_TICKET_SECRET: 'c'.repeat(64),
    })).toThrow('不能复用')
  })

  it('测试身份函数使用的每个私有占位符都记录在环境变量模板中', () => {
    const names = requiredEnvironmentNames(productionConfig, TEST_IDENTITY_FUNCTIONS)

    for (const name of names)
      expect(envExample, `.env.example 缺少 ${name}`).toMatch(new RegExp(`^${name}=`, 'm'))
  })

  it('ci 登录配置不解析任何函数密钥', () => {
    expect(ciConfig).toEqual({
      version: '2.0',
      envId: '{{env.CLOUDBASE_ENV_ID}}',
      functionRoot: './cloudfunctions',
      functions: [],
    })
  })

  it('读取 CloudBase CLI 配置前会转义多行和 JSON 环境变量', () => {
    const source = JSON.stringify({
      functions: [{
        name: 'sso-ticket',
        envVariables: {
          PRIVATE_KEY: '{{env.PRIVATE_KEY}}',
          PUBLIC_KEYS: '{{env.PUBLIC_KEYS}}',
        },
      }],
    })
    const rawEnvironment = {
      PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nline\\value\n-----END PRIVATE KEY-----',
      PUBLIC_KEYS: '{"old-key":{"kty":"OKP","crv":"Ed25519"}}',
      UNRELATED: 'unchanged',
    }
    const childEnvironment = createCloudBaseConfigEnvironment(JSON.parse(source), rawEnvironment)
    const rendered = source
      .replace('{{env.PRIVATE_KEY}}', childEnvironment.PRIVATE_KEY)
      .replace('{{env.PUBLIC_KEYS}}', childEnvironment.PUBLIC_KEYS)
    const variables = JSON.parse(rendered).functions[0].envVariables

    expect(variables).toEqual({
      PRIVATE_KEY: rawEnvironment.PRIVATE_KEY,
      PUBLIC_KEYS: rawEnvironment.PUBLIC_KEYS,
    })
    expect(childEnvironment.UNRELATED).toBe('unchanged')
    expect(rawEnvironment.PRIVATE_KEY).toContain('\n')
  })

  it('拒绝测试身份密钥格式错误、内部令牌过短或跨用途复用', () => {
    const env = completeTestIdentityEnv()

    expect(() => assertFunctionEnvironmentReady(
      productionConfig,
      TEST_IDENTITY_FUNCTIONS,
      { ...env, TEST_TICKET_ESCROW_KEY: 'not-base64' },
    )).toThrow('32-byte base64')

    expect(() => assertFunctionEnvironmentReady(
      productionConfig,
      TEST_IDENTITY_FUNCTIONS,
      { ...env, TEST_BROKER_RECONCILE_TOKEN: 'short' },
    )).toThrow('32～512 bytes')

    expect(() => assertFunctionEnvironmentReady(
      productionConfig,
      TEST_IDENTITY_FUNCTIONS,
      { ...env, TEST_BROKER_RECONCILE_TOKEN: env.AI_GATEWAY_ACCOUNT_API_TOKEN },
    )).toThrow('跨用途复用')

    expect(() => assertFunctionEnvironmentReady(
      productionConfig,
      TEST_IDENTITY_FUNCTIONS,
      { ...env, PLAY_PACHINKO_ACCOUNT_API_TOKEN: 'short' },
    )).toThrow('32～512 bytes')

    expect(() => assertFunctionEnvironmentReady(
      productionConfig,
      TEST_IDENTITY_FUNCTIONS,
      { ...env, PLAY_PACHINKO_ACCOUNT_API_TOKEN: env.AI_GATEWAY_ACCOUNT_API_TOKEN },
    )).toThrow('跨用途复用')

    expect(() => assertFunctionEnvironmentReady(
      productionConfig,
      TEST_IDENTITY_FUNCTIONS,
      { ...env, YUNLEFUN_AI_RUNTIME_ACCOUNT_API_TOKEN: 'short' },
    )).toThrow('32～512 bytes')

    expect(() => assertFunctionEnvironmentReady(
      productionConfig,
      TEST_IDENTITY_FUNCTIONS,
      { ...env, YUNLEFUN_AI_RUNTIME_ACCOUNT_API_TOKEN: env.ACCOUNT_API_INTERNAL_TOKEN },
    )).toThrow('跨用途复用')

    expect(() => assertFunctionEnvironmentReady(
      productionConfig,
      TEST_IDENTITY_FUNCTIONS,
      { ...env, AUTH_ISSUER_ENVIRONMENT: 'development' },
    )).toThrow('AUTH_ISSUER_ENVIRONMENT=production')
  })
})

function completeTestIdentityEnv() {
  const key = fill => Buffer.alloc(32, fill).toString('base64')
  const token = fill => `${fill}`.repeat(64)
  return {
    ACCOUNT_API_INTERNAL_TOKEN: token('a'),
    YUNLEFUN_AI_RUNTIME_ACCOUNT_API_TOKEN: token('j'),
    AI_GATEWAY_ACCOUNT_API_TOKEN: token('b'),
    PLAY_PACHINKO_ACCOUNT_API_TOKEN: token('d'),
    TEST_BROKER_ACCOUNT_API_TOKEN: token('c'),
    REWARD_CONTROL_TOKENS: key(4),
    REWARD_CLAIM_LINK_HASH_KEY: token('e'),
    REWARD_CLAIM_RATE_TICKET_SECRET: token('f'),
    TEST_LEASE_CAPABILITY_SIGNING_KEY: key(7),
    TEST_BROKER_RECONCILE_TOKEN: token('h'),
    SSO_TICKET_PRIVATE_KEY_ID: 'private-key-id',
    SSO_TICKET_PRIVATE_KEY: 'private-key',
    SSO_TICKET_REFRESH_SEC: '2592000',
    AUTH_ISSUER_ENVIRONMENT: 'production',
    SSO_IDENTITY_SIGNING_KEY: 'identity-signing-key',
    SSO_IDENTITY_SIGNING_KID: 'identity-key-id',
    SSO_IDENTITY_PUBLIC_KEYS: '{}',
    SSO_IDENTITY_ASSERTION_TTL_SEC: '120',
    SSO_ISSUE_PER_USER_PER_MINUTE: '10',
    SSO_ISSUE_PER_IP_PER_MINUTE: '30',
    SSO_EXCHANGE_PER_IP_PER_MINUTE: '60',
    SSO_EXCHANGE_PER_ORIGIN_PER_MINUTE: '300',
    TEST_BROKER_INTERNAL_TOKEN: token('i'),
    TEST_TICKET_ESCROW_KEY: key(11),
    TEST_BROKER_SWEEP_KEY: key(12),
  }
}
