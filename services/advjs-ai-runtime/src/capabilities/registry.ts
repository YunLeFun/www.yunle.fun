import type { AgentCapabilityId, AgentProposal, JsonValue } from '../contracts/v1.js'
import type { TokenUsageBuckets } from '../domain/pricing.js'

export interface CapabilityProjectContext {
  id: string
  revision: string
  files: Readonly<Record<string, string>>
}

export interface NormalizedCapabilityRequest {
  input: JsonValue
  project: CapabilityProjectContext
}

export interface CapabilityPrompt {
  system: string
  user: string
}

export interface CapabilityCandidate {
  streamText: string
  proposal?: AgentProposal
}

export interface CapabilityDefinition {
  id: AgentCapabilityId
  executor: 'model' | 'agent'
  promptVersion: string
  parserVersion: string
  safetyVersion: string
  executorVersion: string
  allowedProjectPathPatterns: readonly string[]
  maxInputBytes: number
  maxOutputTokens: number
  temperatureMilli: number
  timeoutMs: number
  normalizeRequest: (input: unknown, project: CapabilityProjectContext) => NormalizedCapabilityRequest
  assertInputSafe: (request: NormalizedCapabilityRequest) => void
  buildPrompt: (request: NormalizedCapabilityRequest) => CapabilityPrompt
  parseCandidate: (output: string, request: NormalizedCapabilityRequest) => Promise<CapabilityCandidate>
  maxUsage: TokenUsageBuckets
  maxAutomaticAttempts: number
}

export interface CapabilityRegistry {
  get: (id: AgentCapabilityId) => CapabilityDefinition | undefined
}

export class InMemoryCapabilityRegistry implements CapabilityRegistry {
  readonly #definitions: ReadonlyMap<AgentCapabilityId, CapabilityDefinition>

  constructor(definitions: readonly CapabilityDefinition[] = []) {
    this.#definitions = new Map(definitions.map(definition => [definition.id, definition]))
  }

  get(id: AgentCapabilityId): CapabilityDefinition | undefined {
    return this.#definitions.get(id)
  }
}
