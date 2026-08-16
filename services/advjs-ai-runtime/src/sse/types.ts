import type { AgentEventEnvelope } from '../contracts/v1.js'

export interface EventStream {
  readonly closed: boolean
  send: (event: AgentEventEnvelope) => void
  end: (event?: AgentEventEnvelope) => void
  onClose: (callback: () => void) => void
}
