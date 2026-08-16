export const BETA_USER_RATE_BPS = 10_000 as const
export const BETA_FIXED_CAPABILITY_FEE_MICRO_POINTS = 0 as const
export const BETA_MINIMUM_CHARGE_MICRO_POINTS = 0 as const

const BASIS_POINTS_DENOMINATOR = 10_000n
const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER)

export interface PricingSnapshot {
  version: string
  billingUnit: number
  inputMicroCnyPerUnit: number
  outputMicroCnyPerUnit: number
  cachedInputMicroCnyPerUnit?: number
  reasoningMicroCnyPerUnit?: number
  userRateBps: number
  fixedCapabilityFeeMicroPoints: number
  minimumChargeMicroPoints: number
}

export interface CreateBetaPricingSnapshotInput {
  version: string
  billingUnit: number
  inputMicroCnyPerUnit: number
  outputMicroCnyPerUnit: number
  cachedInputMicroCnyPerUnit?: number
  reasoningMicroCnyPerUnit?: number
}

export interface TokenUsageBuckets {
  inputTokens: number
  outputTokens: number
  cachedInputTokens?: number
  reasoningTokens?: number
}

export interface UsageCharge {
  bucketCostsMicroCny: {
    inputTokens: number
    outputTokens: number
    cachedInputTokens: number
    reasoningTokens: number
  }
  providerCostMicroCny: number
  userChargeMicroPoints: number
}

export interface AuthorizationCeilingsInput {
  maxUsage: TokenUsageBuckets
  maxAutomaticAttempts: number
  pricing: PricingSnapshot
}

export interface AuthorizationCeilings {
  singleAttemptProviderCostMicroCny: number
  platformReserveMicroCny: number
  userReserveMicroPoints: number
}

function assertNonNegativeSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new TypeError(`${field} must be a non-negative safe integer`)
}

function assertPositiveSafeInteger(value: number, field: string): void {
  assertNonNegativeSafeInteger(value, field)
  if (value === 0)
    throw new TypeError(`${field} must be greater than zero`)
}

function toSafeInteger(value: bigint, field: string): number {
  if (value > MAX_SAFE_INTEGER)
    throw new RangeError(`${field} exceeds the safe integer range`)
  return Number(value)
}

function ceilDivide(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator
}

function calculateBucketCost(
  usage: number,
  priceMicroCnyPerUnit: number | undefined,
  billingUnit: number,
  bucket: string,
): number {
  assertNonNegativeSafeInteger(usage, bucket)
  if (usage === 0)
    return 0
  if (priceMicroCnyPerUnit === undefined)
    throw new TypeError(`${bucket} price is required when usage is non-zero`)
  assertNonNegativeSafeInteger(priceMicroCnyPerUnit, `${bucket} price`)

  return toSafeInteger(
    ceilDivide(BigInt(usage) * BigInt(priceMicroCnyPerUnit), BigInt(billingUnit)),
    `${bucket} cost`,
  )
}

function safeSum(values: readonly number[], field: string): number {
  const value = values.reduce((sum, item) => sum + BigInt(item), 0n)
  return toSafeInteger(value, field)
}

function safeMultiply(left: number, right: number, field: string): number {
  assertNonNegativeSafeInteger(left, `${field} left operand`)
  assertNonNegativeSafeInteger(right, `${field} right operand`)
  return toSafeInteger(BigInt(left) * BigInt(right), field)
}

export function createBetaPricingSnapshot(input: CreateBetaPricingSnapshotInput): Readonly<PricingSnapshot> {
  if (!input.version)
    throw new TypeError('pricing version is required')
  assertPositiveSafeInteger(input.billingUnit, 'billingUnit')
  assertNonNegativeSafeInteger(input.inputMicroCnyPerUnit, 'inputMicroCnyPerUnit')
  assertNonNegativeSafeInteger(input.outputMicroCnyPerUnit, 'outputMicroCnyPerUnit')
  if (input.cachedInputMicroCnyPerUnit !== undefined)
    assertNonNegativeSafeInteger(input.cachedInputMicroCnyPerUnit, 'cachedInputMicroCnyPerUnit')
  if (input.reasoningMicroCnyPerUnit !== undefined)
    assertNonNegativeSafeInteger(input.reasoningMicroCnyPerUnit, 'reasoningMicroCnyPerUnit')

  return Object.freeze({
    version: input.version,
    billingUnit: input.billingUnit,
    inputMicroCnyPerUnit: input.inputMicroCnyPerUnit,
    outputMicroCnyPerUnit: input.outputMicroCnyPerUnit,
    ...(input.cachedInputMicroCnyPerUnit === undefined
      ? {}
      : { cachedInputMicroCnyPerUnit: input.cachedInputMicroCnyPerUnit }),
    ...(input.reasoningMicroCnyPerUnit === undefined
      ? {}
      : { reasoningMicroCnyPerUnit: input.reasoningMicroCnyPerUnit }),
    userRateBps: BETA_USER_RATE_BPS,
    fixedCapabilityFeeMicroPoints: BETA_FIXED_CAPABILITY_FEE_MICRO_POINTS,
    minimumChargeMicroPoints: BETA_MINIMUM_CHARGE_MICRO_POINTS,
  })
}

export function calculateUsageCharge(usage: TokenUsageBuckets, pricing: PricingSnapshot): UsageCharge {
  assertPositiveSafeInteger(pricing.billingUnit, 'billingUnit')
  assertNonNegativeSafeInteger(pricing.userRateBps, 'userRateBps')
  assertNonNegativeSafeInteger(pricing.fixedCapabilityFeeMicroPoints, 'fixedCapabilityFeeMicroPoints')
  assertNonNegativeSafeInteger(pricing.minimumChargeMicroPoints, 'minimumChargeMicroPoints')

  const bucketCostsMicroCny = {
    inputTokens: calculateBucketCost(
      usage.inputTokens,
      pricing.inputMicroCnyPerUnit,
      pricing.billingUnit,
      'inputTokens',
    ),
    outputTokens: calculateBucketCost(
      usage.outputTokens,
      pricing.outputMicroCnyPerUnit,
      pricing.billingUnit,
      'outputTokens',
    ),
    cachedInputTokens: calculateBucketCost(
      usage.cachedInputTokens ?? 0,
      pricing.cachedInputMicroCnyPerUnit,
      pricing.billingUnit,
      'cachedInputTokens',
    ),
    reasoningTokens: calculateBucketCost(
      usage.reasoningTokens ?? 0,
      pricing.reasoningMicroCnyPerUnit,
      pricing.billingUnit,
      'reasoningTokens',
    ),
  }
  const providerCostMicroCny = safeSum(Object.values(bucketCostsMicroCny), 'provider cost')
  const variableCharge = toSafeInteger(
    ceilDivide(BigInt(providerCostMicroCny) * BigInt(pricing.userRateBps), BASIS_POINTS_DENOMINATOR),
    'user variable charge',
  )
  const calculatedCharge = safeSum(
    [variableCharge, pricing.fixedCapabilityFeeMicroPoints],
    'user charge',
  )

  return {
    bucketCostsMicroCny,
    providerCostMicroCny,
    userChargeMicroPoints: Math.max(calculatedCharge, pricing.minimumChargeMicroPoints),
  }
}

export function calculateAuthorizationCeilings(input: AuthorizationCeilingsInput): AuthorizationCeilings {
  assertPositiveSafeInteger(input.maxAutomaticAttempts, 'maxAutomaticAttempts')
  const charge = calculateUsageCharge(input.maxUsage, input.pricing)

  return {
    singleAttemptProviderCostMicroCny: charge.providerCostMicroCny,
    platformReserveMicroCny: safeMultiply(
      charge.providerCostMicroCny,
      input.maxAutomaticAttempts,
      'platform reservation',
    ),
    userReserveMicroPoints: charge.userChargeMicroPoints,
  }
}

export class PricingRegistry {
  readonly #snapshots: ReadonlyMap<string, Readonly<PricingSnapshot>>

  constructor(snapshots: readonly Readonly<PricingSnapshot>[]) {
    this.#snapshots = new Map(snapshots.map(snapshot => [snapshot.version, snapshot]))
  }

  getRequired(version: string): Readonly<PricingSnapshot> {
    const snapshot = this.#snapshots.get(version)
    if (!snapshot)
      throw new Error(`Unknown pricing version: ${version}`)
    return snapshot
  }
}
