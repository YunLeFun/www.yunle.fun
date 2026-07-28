import { describe, expect, it } from 'vitest'

import {
  assertFunctionEnvironmentReady,
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
})
