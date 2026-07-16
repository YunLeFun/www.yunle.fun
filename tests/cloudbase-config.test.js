import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const config = JSON.parse(await readFile(new URL('../cloudbaserc.json', import.meta.url), 'utf8'))
const functions = new Map(config.functions.map(item => [item.name, item]))

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
      TEST_BROKER_INTERNAL_TOKEN: '{{env.TEST_BROKER_INTERNAL_TOKEN}}',
      TEST_TICKET_ESCROW_KEY: '{{env.TEST_TICKET_ESCROW_KEY}}',
    })
  })

  it('runs the HMAC-authenticated sweep every minute', () => {
    expect(functions.get('test-identity-sweeper')).toMatchObject({
      aclRule: { invoke: false },
      envVariables: { TEST_BROKER_SWEEP_KEY: '{{env.TEST_BROKER_SWEEP_KEY}}' },
      triggers: [{ name: 'testIdentitySweepEveryMinute', type: 'timer', config: '0 * * * * * *' }],
    })
  })

  it('requires CloudBase authentication on browser-callable business functions', () => {
    expect(functions.get('sso-ticket').aclRule).toEqual({ invoke: 'auth != null' })
    expect(functions.get('account-api').aclRule).toEqual({ invoke: 'auth != null' })
    expect(functions.get('ai-gateway').aclRule).toEqual({ invoke: 'auth != null' })
  })
})
