import { describe, expect, it } from 'vitest'

import { AI_SDK_TIMEOUT_MS } from '../../cloudfunctions/ai-gateway/lib/runtime.js'

describe('ai-gateway runtime', () => {
  it('keeps the model client timeout below the function timeout', () => {
    expect(AI_SDK_TIMEOUT_MS).toBe(60_000)
  })
})
