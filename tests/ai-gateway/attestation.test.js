import { describe, expect, it } from 'vitest'

import {
  createSigningPayload,
  signAppRequest,
  signRateLimitRequest,
  verifyAppRequest,
  verifyRateLimitRequest,
} from '../../cloudfunctions/ai-gateway/lib/attestation.js'

const input = {
  appId: 'zero-echo-2026',
  bizId: 'turn-1',
  messages: [
    { role: 'system', content: 'system' },
    { role: 'user', content: 'question' },
  ],
  timestamp: 1_700_000_000_000,
}

describe('ai-gateway app attestation', () => {
  it('creates a deterministic signature and verifies a fresh request', () => {
    const signature = signAppRequest('test-secret', input)

    expect(createSigningPayload(input)).toContain('zero-echo-2026\nturn-1')
    expect(signature).toHaveLength(64)
    expect(verifyAppRequest('test-secret', { ...input, signature }, { now: input.timestamp })).toBe(true)
  })

  it('rejects tampered messages, wrong secrets, and stale timestamps', () => {
    const signature = signAppRequest('test-secret', input)

    expect(verifyAppRequest('wrong-secret', { ...input, signature }, { now: input.timestamp })).toBe(false)
    expect(verifyAppRequest('test-secret', {
      ...input,
      messages: [{ role: 'user', content: 'tampered' }],
      signature,
    }, { now: input.timestamp })).toBe(false)
    expect(verifyAppRequest('test-secret', { ...input, signature }, { now: input.timestamp + 120_001 })).toBe(false)
  })

  it('binds rate-limit attestations to the app, pseudonymous client, and timestamp', () => {
    const rateInput = {
      appId: 'zero-echo-2026',
      clientKey: 'a'.repeat(64),
      timestamp: input.timestamp,
    }
    const signature = signRateLimitRequest('test-secret', rateInput)

    expect(verifyRateLimitRequest('test-secret', {
      ...rateInput,
      signature,
    }, { now: rateInput.timestamp })).toBe(true)
    expect(verifyRateLimitRequest('test-secret', {
      ...rateInput,
      clientKey: 'b'.repeat(64),
      signature,
    }, { now: rateInput.timestamp })).toBe(false)
  })
})
