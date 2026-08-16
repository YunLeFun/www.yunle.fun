import type { RuntimeDependencies } from '../dependencies.js'
import type { RuntimeRequestHandler, RuntimeResponse } from './types.js'
import { AGENT_PROTOCOL_VERSION } from '../contracts/v1.js'

const JSON_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
})

export function createRuntimeHandler(_dependencies: RuntimeDependencies): RuntimeRequestHandler {
  return async (request): Promise<RuntimeResponse> => {
    if (request.method === 'GET' && request.path === '/health') {
      return {
        status: 200,
        headers: JSON_HEADERS,
        body: {
          ok: true,
          protocolVersion: AGENT_PROTOCOL_VERSION,
          service: 'advjs-ai-runtime',
        },
      }
    }

    return {
      status: 404,
      headers: JSON_HEADERS,
      body: {
        error: {
          code: 'not_found',
          message: 'Route not found',
        },
      },
    }
  }
}
