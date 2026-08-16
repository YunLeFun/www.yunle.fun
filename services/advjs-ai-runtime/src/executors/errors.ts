import type { ModelUsage } from './types.js'

export interface ModelExecutionErrorOptions {
  retryable: boolean
  requestId?: string
  usage?: ModelUsage
}

export class ModelExecutionError extends Error {
  readonly retryable: boolean
  readonly requestId: string | undefined
  readonly usage: ModelUsage | undefined

  constructor(message: string, options: ModelExecutionErrorOptions) {
    super(message)
    this.retryable = options.retryable
    this.requestId = options.requestId
    this.usage = options.usage
  }
}

export interface ModelExecutionUncertainErrorOptions {
  requestId?: string
  usage?: ModelUsage
}

export class ModelExecutionUncertainError extends Error {
  readonly requestId: string | undefined
  readonly usage: ModelUsage | undefined

  constructor(message: string, options: ModelExecutionUncertainErrorOptions = {}) {
    super(message)
    this.requestId = options.requestId
    this.usage = options.usage
  }
}
