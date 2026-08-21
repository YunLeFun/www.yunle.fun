import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import { requiredEnvironmentNames } from '../scripts/deploy-function-safety.mjs'

const config = JSON.parse(await readFile(
  new URL('../cloudbaserc.test-accounts-development.json', import.meta.url),
  'utf8',
))

describe('development fixed test account deployment', () => {
  it('targets the development environment with only the required functions', () => {
    expect(config.envId).toBe('yunlefun-dev-0ge03bdod37093d1')
    expect(config.functions.map(item => item.name)).toEqual([
      'account-api',
      'wxpay-order',
    ])
  })

  it('requires authenticated invocation and marks every function as test', () => {
    for (const item of config.functions) {
      expect(item.runtime).toBe('Nodejs18.15')
      expect(item.handler).toBe('index.main')
      expect(item.aclRule?.invoke).toBe('auth != null')
      expect(item.envVariables.YUNLEFUN_TEST_ACCOUNT_ENVIRONMENT).toBe('test')
    }
  })

  it('keeps production payment credentials out of the synthetic-only environment', () => {
    expect(requiredEnvironmentNames(config, ['wxpay-order'])).toEqual([
      'ACCOUNT_API_INTERNAL_TOKEN',
    ])
    const environmentNames = Object.keys(
      config.functions.find(item => item.name === 'wxpay-order').envVariables,
    )
    expect(environmentNames).not.toContainEqual(expect.stringMatching(/^WX_/))
  })
})
