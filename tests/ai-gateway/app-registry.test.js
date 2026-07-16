import { describe, expect, it } from 'vitest'

import {
  APP_REGISTRY,
  messageLimitsForApp,
} from '../../cloudfunctions/ai-gateway/lib/app-registry.js'
import { assertMessages } from '../../cloudfunctions/ai-gateway/lib/validation.js'

describe('ai-gateway app registry', () => {
  it('registers everything-generator with the existing metered model', () => {
    expect(APP_REGISTRY['everything-generator']).toMatchObject({
      billing: 'coin',
      cost: 1,
      group: 'custom-deepseek-open',
      model: 'deepseek-v4-flash',
    })
  })

  it('allows the larger wish finalize payload only for everything-generator', () => {
    const messages = [{ role: 'user', content: '愿'.repeat(12_000) }]

    expect(() => assertMessages(messages)).toThrow('messages 内容过长')
    expect(assertMessages(messages, messageLimitsForApp(APP_REGISTRY['everything-generator'])))
      .toEqual(messages)
  })
})
