import type {
  ClientRegistrySnapshot,
  RegistryEnvironment,
  RegistryTrustAnchors,
} from './registry-types'
import { hashRegistry } from './registry-canonical'
import { RegistryValidationError } from './registry-schema'
import { verifyRegistryActiveEnvelope } from './registry-signature'

export type RegistryShadowEventName
  = | 'registry_shadow_match'
    | 'registry_shadow_display_drift'
    | 'registry_shadow_security_drift'
    | 'registry_shadow_unavailable'
    | 'registry_shadow_invalid'
    | 'registry_shadow_signature_invalid'
    | 'registry_shadow_activation_replayed'

export interface RegistryShadowEvent {
  event: RegistryShadowEventName
  environment: RegistryEnvironment
  snapshotId?: string
  generation?: number
  policyVersion?: string
  staticContentHash: string
  staticSecurityHash: string
  platformContentHash?: string
  platformSecurityHash?: string
  code?: string
  observedAt: number
}

export interface RegistryShadowStatus {
  lastEvent: RegistryShadowEvent | null
  lastSuccessfulAt: number | null
  nextRefreshAt: number
  refreshing: boolean
  counts: Readonly<Record<RegistryShadowEventName, number>>
}

export interface RegistryShadowObserver {
  observe: () => Promise<RegistryShadowEvent>
  getStatus: () => RegistryShadowStatus
}

const EVENT_NAMES: readonly RegistryShadowEventName[] = [
  'registry_shadow_match',
  'registry_shadow_display_drift',
  'registry_shadow_security_drift',
  'registry_shadow_unavailable',
  'registry_shadow_invalid',
  'registry_shadow_signature_invalid',
  'registry_shadow_activation_replayed',
]

class RegistryShadowTimeoutError extends Error {}

function initialCounts(): Record<RegistryShadowEventName, number> {
  return Object.fromEntries(EVENT_NAMES.map(name => [name, 0])) as Record<RegistryShadowEventName, number>
}

function errorEvent(error: unknown): { event: RegistryShadowEventName, code: string } {
  if (error instanceof RegistryShadowTimeoutError)
    return { event: 'registry_shadow_unavailable', code: 'registry_shadow_timeout' }
  if (!(error instanceof RegistryValidationError))
    return { event: 'registry_shadow_unavailable', code: 'registry_load_failed' }
  if (error.code === 'registry_activation_replayed')
    return { event: 'registry_shadow_activation_replayed', code: error.code }
  if (error.code === 'registry_signature_invalid' || error.code === 'registry_signature_key_unknown')
    return { event: 'registry_shadow_signature_invalid', code: error.code }
  return { event: 'registry_shadow_invalid', code: error.code }
}

function eventKey(event: RegistryShadowEvent): string {
  return [
    event.event,
    event.snapshotId,
    event.generation,
    event.platformContentHash,
    event.platformSecurityHash,
    event.code,
  ].join('\0')
}

export function createRegistryShadowObserver(options: {
  environment: RegistryEnvironment
  staticRegistry: ClientRegistrySnapshot
  minimumGeneration?: number
  trustAnchors: RegistryTrustAnchors
  loadEnvelope: () => Promise<unknown>
  report?: (event: RegistryShadowEvent) => void
  now?: () => number
  ttlMs?: number
  failureTtlMs?: number
  timeoutMs?: number
}): RegistryShadowObserver {
  const now = options.now ?? Date.now
  const ttlMs = options.ttlMs ?? 300_000
  const failureTtlMs = options.failureTtlMs ?? 30_000
  const timeoutMs = options.timeoutMs ?? 250
  const staticHashes = hashRegistry(options.staticRegistry)
  const counts = initialCounts()
  let lastEvent: RegistryShadowEvent | null = null
  let lastReportedKey = ''
  let lastSuccessfulAt: number | null = null
  let nextRefreshAt = 0
  let inFlight: Promise<RegistryShadowEvent> | null = null

  function emit(event: RegistryShadowEvent): RegistryShadowEvent {
    counts[event.event] += 1
    lastEvent = event
    const key = eventKey(event)
    if (key !== lastReportedKey) {
      lastReportedKey = key
      try {
        options.report?.(event)
      }
      catch (error) {
        // Telemetry callbacks are never allowed to affect the authorization path.
        void error
      }
    }
    return event
  }

  function baseEvent(observedAt: number) {
    return {
      environment: options.environment,
      staticContentHash: staticHashes.contentHash,
      staticSecurityHash: staticHashes.securityHash,
      observedAt,
    }
  }

  async function refresh(): Promise<RegistryShadowEvent> {
    const observedAt = now()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const raw = await Promise.race([
        options.loadEnvelope(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new RegistryShadowTimeoutError()), timeoutMs)
        }),
      ])
      const envelope = verifyRegistryActiveEnvelope(raw, {
        environment: options.environment,
        minimumGeneration: options.minimumGeneration,
        trustAnchors: options.trustAnchors,
      })
      const platformHashes = hashRegistry(envelope.snapshot.registry)
      const event: RegistryShadowEvent = {
        ...baseEvent(observedAt),
        event: platformHashes.contentHash === staticHashes.contentHash
          ? 'registry_shadow_match'
          : platformHashes.securityHash === staticHashes.securityHash
            ? 'registry_shadow_display_drift'
            : 'registry_shadow_security_drift',
        snapshotId: envelope.snapshot.snapshotId,
        generation: envelope.state.generation,
        policyVersion: envelope.snapshot.policyVersion,
        platformContentHash: platformHashes.contentHash,
        platformSecurityHash: platformHashes.securityHash,
      }
      lastSuccessfulAt = observedAt
      nextRefreshAt = observedAt + ttlMs
      return emit(event)
    }
    catch (error) {
      const classified = errorEvent(error)
      nextRefreshAt = observedAt + failureTtlMs
      return emit({
        ...baseEvent(observedAt),
        ...classified,
      })
    }
    finally {
      if (timer)
        clearTimeout(timer)
    }
  }

  function currentRefresh(): Promise<RegistryShadowEvent> {
    if (!inFlight) {
      inFlight = refresh().finally(() => {
        inFlight = null
      })
    }
    return inFlight
  }

  return {
    async observe() {
      const observedAt = now()
      if (lastEvent && observedAt < nextRefreshAt)
        return lastEvent
      return currentRefresh()
    },

    getStatus() {
      return {
        lastEvent,
        lastSuccessfulAt,
        nextRefreshAt,
        refreshing: inFlight !== null,
        counts: { ...counts },
      }
    },
  }
}
