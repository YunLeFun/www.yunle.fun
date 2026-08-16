export type CapabilitySafetyCode
  = | 'CONTENT_BLOCKED_MINOR'
    | 'CONTENT_BLOCKED_NON_CONSENSUAL'
    | 'CONTENT_BLOCKED_POLICY'

export class CapabilityInputError extends Error {
  readonly code = 'INVALID_CAPABILITY_INPUT'
}

export class CapabilityOutputError extends Error {
  constructor(
    readonly code: 'OUTPUT_PARSE_FAILED' | 'PROJECT_VALIDATION_FAILED',
    message: string,
  ) {
    super(message)
  }
}

export class CapabilitySafetyError extends Error {
  constructor(readonly code: CapabilitySafetyCode) {
    super('Content could not be processed under the current safety policy')
  }
}
