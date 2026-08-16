import { describe, expect, it } from 'vitest'
import {
  calculateAuthorizationCeilings,
  calculateUsageCharge,
  createBetaPricingSnapshot,
  PricingRegistry,
} from '../domain/pricing.js'

describe('integer pricing snapshots', () => {
  it('rounds each mutually exclusive usage bucket upward before summing', () => {
    const pricing = createBetaPricingSnapshot({
      version: 'pricing_fixture_v1',
      billingUnit: 1_000,
      inputMicroCnyPerUnit: 1,
      outputMicroCnyPerUnit: 1,
    })

    const result = calculateUsageCharge({ inputTokens: 1, outputTokens: 1 }, pricing)

    expect(result).toEqual({
      bucketCostsMicroCny: {
        cachedInputTokens: 0,
        inputTokens: 1,
        outputTokens: 1,
        reasoningTokens: 0,
      },
      providerCostMicroCny: 2,
      userChargeMicroPoints: 2,
    })
    expect(pricing).toMatchObject({
      fixedCapabilityFeeMicroPoints: 0,
      minimumChargeMicroPoints: 0,
      userRateBps: 10_000,
    })
    expect(Object.isFrozen(pricing)).toBe(true)
  })

  it('keeps user reservation to one attempt and platform reservation to all automatic attempts', () => {
    const pricing = createBetaPricingSnapshot({
      version: 'pricing_fixture_v1',
      billingUnit: 1,
      inputMicroCnyPerUnit: 2,
      outputMicroCnyPerUnit: 5,
    })

    expect(calculateAuthorizationCeilings({
      maxAutomaticAttempts: 3,
      maxUsage: { inputTokens: 10, outputTokens: 4 },
      pricing,
    })).toEqual({
      platformReserveMicroCny: 120,
      singleAttemptProviderCostMicroCny: 40,
      userReserveMicroPoints: 40,
    })
  })

  it('rejects missing bucket prices, unknown versions and unsafe integer overflow', () => {
    const pricing = createBetaPricingSnapshot({
      version: 'pricing_fixture_v1',
      billingUnit: 1,
      inputMicroCnyPerUnit: 1,
      outputMicroCnyPerUnit: 1,
    })
    const registry = new PricingRegistry([pricing])

    expect(() => calculateUsageCharge({
      cachedInputTokens: 1,
      inputTokens: 0,
      outputTokens: 0,
    }, pricing)).toThrowError(/cachedInputTokens.*price/i)
    expect(() => registry.getRequired('pricing_unknown')).toThrowError(/unknown pricing version/i)
    expect(() => calculateUsageCharge({
      inputTokens: 2,
      outputTokens: 0,
    }, createBetaPricingSnapshot({
      version: 'pricing_overflow',
      billingUnit: 1,
      inputMicroCnyPerUnit: Number.MAX_SAFE_INTEGER,
      outputMicroCnyPerUnit: 0,
    }))).toThrowError(/safe integer/i)
  })
})
