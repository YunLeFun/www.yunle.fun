import { describe, expect, it } from 'vitest'
import { createCloudRunMain, mapCloudRunRequest, toCloudRunResponse } from '../index.js'
import { createFakeRuntimeDependencies } from '../testing/fakes.js'

describe('cloudbase function mode entry', () => {
  it('maps request metadata from context and keeps event as the request body', () => {
    const body = { capability: 'generate-outline' }

    expect(mapCloudRunRequest(body, {
      httpContext: {
        headers: {
          'authorization': 'Bearer fixture',
          'x-forwarded-for': ['127.0.0.1', '10.0.0.1'],
        },
        httpMethod: 'POST',
        url: 'http://localhost:3000/v1/tasks?source=studio',
      },
    })).toEqual({
      body,
      headers: {
        'authorization': 'Bearer fixture',
        'x-forwarded-for': '127.0.0.1',
      },
      method: 'POST',
      path: '/v1/tasks?source=studio',
    })
  })

  it('returns the CloudBase integrated response shape', () => {
    expect(toCloudRunResponse({
      body: { data: { ok: true } },
      headers: { 'content-type': 'application/json' },
      status: 201,
    })).toEqual({
      body: { data: { ok: true } },
      headers: { 'content-type': 'application/json' },
      statusCode: 201,
    })
  })

  it('opens Function Mode SSE with exact CORS headers for an owned task', async () => {
    const dependencies = createFakeRuntimeDependencies()
    await dependencies.tasks.create({
      id: 'task_sse_entry_fixture',
      uid: 'uid_fixture_001',
      capability: 'generate-outline',
      status: 'completed',
      billingStatus: 'settled',
      streamText: '完成',
      streamRevision: 1,
      version: 1,
    })
    const opened: Record<string, unknown>[] = []
    const sent: { event?: string }[] = []
    let resolveEnded!: () => void
    const ended = new Promise<void>(resolve => resolveEnded = resolve)
    const run = createCloudRunMain(dependencies, {
      appId: 'advjs-studio-web',
      allowedOrigins: ['https://editor.advjs.org'],
    })

    const result = await run({}, {
      httpContext: {
        headers: {
          authorization: 'Bearer fixture',
          origin: 'https://editor.advjs.org',
        },
        httpMethod: 'GET',
        url: 'http://localhost/v1/tasks/task_sse_entry_fixture/events',
      },
      sse: (options) => {
        opened.push(options ?? {})
        return {
          closed: false,
          end: (event) => {
            sent.push(event)
            resolveEnded()
          },
          on: () => {},
          send: (event) => {
            sent.push(event)
            return true
          },
        }
      },
    })
    await ended

    expect(result).toBe('')
    expect(opened).toEqual([{
      headers: expect.objectContaining({
        'access-control-allow-origin': 'https://editor.advjs.org',
        'vary': 'Origin',
      }),
      keepalive: false,
    }])
    expect(sent.map(event => event.event)).toEqual(['state.snapshot', 'run.finished'])
  })
})
