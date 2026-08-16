import type { JsonValue } from '../contracts/v1.js'

export interface RuntimeRequest {
  method: string
  path: string
  headers: Readonly<Record<string, string | undefined>>
  body?: unknown
}

export interface RuntimeResponse {
  status: number
  headers: Readonly<Record<string, string>>
  body: JsonValue
}

export type RuntimeRequestHandler = (request: RuntimeRequest) => Promise<RuntimeResponse>
