const ENV_ID_PATTERN = /^[a-z0-9][a-z0-9-]{10,63}$/i
const TOKEN_MINIMUM_LENGTH = 32

export interface ProductionRuntimeConfig {
  envId: string
  allowedOrigins: readonly string[]
  adminToken: string
  accountApiToken: string
  clientAppId: 'advjs-studio-web'
  billingAppId: 'advjs-studio'
  scope: 'studio-managed-ai'
  activeTaskTtlMs: number
  leaseDurationMs: number
  staleTaskAfterMs: number
  workerPollMs: number
  workerBatchSize: number
  sweepIntervalMs: number
}

export type RuntimeEnvironment = Readonly<Record<string, string | undefined>>

function required(environment: RuntimeEnvironment, name: string): string {
  const value = environment[name]?.trim()
  if (!value)
    throw new TypeError(`${name} is required`)
  return value
}

function serviceCredential(environment: RuntimeEnvironment, name: string): string {
  const value = required(environment, name)
  if (value.length < TOKEN_MINIMUM_LENGTH || /\s/.test(value))
    throw new TypeError(`${name} must be a strong service credential`)
  return value
}

function integerSetting(
  environment: RuntimeEnvironment,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = environment[name]?.trim()
  if (!raw)
    return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new TypeError(`${name} is outside the supported range`)
  return value
}

function exactHttpsOrigin(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  }
  catch {
    throw new TypeError('ADVJS_AI_ALLOWED_ORIGINS contains an invalid origin')
  }
  if (url.protocol !== 'https:'
    || url.username
    || url.password
    || url.pathname !== '/'
    || url.search
    || url.hash
    || url.origin !== value) {
    throw new TypeError('ADVJS_AI_ALLOWED_ORIGINS must contain exact HTTPS origins')
  }
  return url.origin
}

function allowedOrigins(environment: RuntimeEnvironment): readonly string[] {
  const origins = required(environment, 'ADVJS_AI_ALLOWED_ORIGINS')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
    .map(exactHttpsOrigin)
  if (origins.length === 0 || new Set(origins).size !== origins.length)
    throw new TypeError('ADVJS_AI_ALLOWED_ORIGINS must contain unique exact origins')
  return origins
}

export function loadProductionRuntimeConfig(environment: RuntimeEnvironment): ProductionRuntimeConfig {
  const envId = required(environment, 'ADVJS_AI_CLOUDBASE_ENV_ID')
  if (!ENV_ID_PATTERN.test(envId))
    throw new TypeError('Canonical CloudBase environment ID is required')
  const adminToken = serviceCredential(environment, 'ADVJS_AI_ADMIN_TOKEN')
  const accountApiToken = serviceCredential(environment, 'ADVJS_AI_ACCOUNT_API_TOKEN')
  if (adminToken === accountApiToken)
    throw new TypeError('Admin and account-api credentials must remain separate')

  return {
    envId,
    allowedOrigins: allowedOrigins(environment),
    adminToken,
    accountApiToken,
    clientAppId: 'advjs-studio-web',
    billingAppId: 'advjs-studio',
    scope: 'studio-managed-ai',
    activeTaskTtlMs: integerSetting(environment, 'ADVJS_AI_ACTIVE_TASK_TTL_MS', 15 * 60_000, 60_000, 24 * 60 * 60_000),
    leaseDurationMs: integerSetting(environment, 'ADVJS_AI_LEASE_DURATION_MS', 2 * 60_000, 30_000, 15 * 60_000),
    staleTaskAfterMs: integerSetting(environment, 'ADVJS_AI_STALE_TASK_AFTER_MS', 5 * 60_000, 60_000, 24 * 60 * 60_000),
    workerPollMs: integerSetting(environment, 'ADVJS_AI_WORKER_POLL_MS', 500, 100, 60_000),
    workerBatchSize: integerSetting(environment, 'ADVJS_AI_WORKER_BATCH_SIZE', 10, 1, 100),
    sweepIntervalMs: integerSetting(environment, 'ADVJS_AI_SWEEP_INTERVAL_MS', 60_000, 1_000, 60 * 60_000),
  }
}
