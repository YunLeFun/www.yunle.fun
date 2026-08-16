import type { RuntimeTaskRecord } from '../domain/task.js'
import type { SseEvent, SseTransport } from '../sse/task-stream.js'
import { describe, expect, it } from 'vitest'
import { parseAgentEventEnvelope } from '../contracts/v1.js'
import { patchTask } from '../domain/task.js'
import { formatTaskStreamCursor, projectTaskEvents } from '../sse/task-events.js'
import { createTaskStreamPreparer } from '../sse/task-stream.js'
import { createFakeRuntimeDependencies } from '../testing/fakes.js'

const ORIGIN = 'https://editor.advjs.org'

function task(overrides: Partial<RuntimeTaskRecord> = {}): RuntimeTaskRecord {
  return {
    id: 'task_sse_fixture_001',
    uid: 'uid_fixture_001',
    appId: 'advjs-studio-web',
    capability: 'generate-outline',
    status: 'running',
    billingStatus: 'reserved',
    projectId: 'project_fixture_001',
    projectRevision: 'revision_fixture_001',
    reservedMicroPoints: 40,
    chargedMicroPoints: 0,
    streamText: '你好',
    streamRevision: 1,
    attempt: 1,
    createdAt: 100,
    updatedAt: 101,
    version: 1,
    ...overrides,
  }
}

class MemorySseTransport implements SseTransport {
  closed = false
  readonly events: SseEvent[] = []
  #closeListeners: (() => void)[] = []

  end(event: SseEvent): void {
    this.events.push(event)
    this.closed = true
  }

  on(_event: 'close', listener: () => void): void {
    this.#closeListeners.push(listener)
  }

  send(event: SseEvent): boolean {
    this.events.push(event)
    return true
  }

  disconnect(): void {
    for (const listener of this.#closeListeners)
      listener()
    this.closed = true
  }
}

describe('resumable task SSE', () => {
  it('recovers appended Unicode text from an old cursor without duplicating the prefix', () => {
    const cursor = formatTaskStreamCursor({
      attempt: 1,
      offset: 2,
      phase: 1,
      streamRevision: 1,
      taskVersion: 1,
    })
    const current = patchTask(task(), 102, {
      streamRevision: 2,
      streamText: '你好😀终',
    })

    const projected = projectTaskEvents(current, [], cursor)

    expect(projected.events.map(item => item.event.type)).toEqual(['text.delta', 'state.snapshot'])
    expect(projected.events[0]).toMatchObject({
      event: { delta: '😀终', offset: 2, type: 'text.delta' },
    })
    const encoded = new TextEncoder().encode(JSON.stringify(projected.events[0]))
    expect(new TextDecoder().decode(encoded)).toContain('😀终')
  })

  it('uses a full snapshot when the attempt changed or an offset splits a surrogate pair', () => {
    const staleAttempt = formatTaskStreamCursor({
      attempt: 1,
      offset: 2,
      phase: 1,
      streamRevision: 1,
      taskVersion: 1,
    })
    const splitEmoji = formatTaskStreamCursor({
      attempt: 2,
      offset: 1,
      phase: 1,
      streamRevision: 3,
      taskVersion: 3,
    })
    const current = task({ attempt: 2, streamRevision: 3, streamText: '😀新', version: 3 })

    expect(projectTaskEvents(current, [], staleAttempt).events[0]?.event.type).toBe('state.snapshot')
    expect(projectTaskEvents(current, [], splitEmoji).events[0]?.event.type).toBe('state.snapshot')
  })

  it('authenticates, enforces ownership and closes a terminal stream with stable events', async () => {
    const dependencies = createFakeRuntimeDependencies()
    await dependencies.tasks.create(task({
      status: 'completed',
      billingStatus: 'settled',
      streamText: '完成😀',
      streamRevision: 2,
      chargedMicroPoints: 20,
      completedAt: 110,
    }))
    const prepare = createTaskStreamPreparer(dependencies, { allowedOrigins: [ORIGIN] })
    const request = {
      headers: { authorization: 'Bearer fixture', origin: ORIGIN },
      method: 'GET',
      path: '/v1/tasks/task_sse_fixture_001/events',
    }

    const prepared = await prepare(request)
    expect(prepared.kind).toBe('stream')
    if (prepared.kind !== 'stream')
      throw new Error('Expected stream preparation')
    const transport = new MemorySseTransport()
    await prepared.start(transport)

    expect(transport.closed).toBe(true)
    expect(transport.events.map(item => item.event)).toEqual([
      'state.snapshot',
      'run.finished',
    ])
    expect(new Set(transport.events.map(item => item.id)).size).toBe(2)
    for (const event of transport.events)
      expect(() => parseAgentEventEnvelope(JSON.parse(event.data))).not.toThrow()

    const otherUser = createTaskStreamPreparer({
      ...dependencies,
      auth: { verifyAccessToken: async () => ({ uid: 'uid_other_fixture' }) },
    }, { allowedOrigins: [ORIGIN] })
    await expect(otherUser(request)).resolves.toMatchObject({
      kind: 'response',
      response: { status: 404, body: { error: { code: 'TASK_NOT_FOUND' } } },
    })
  })

  it('does not mutate or cancel a task when a read-only stream disconnects', async () => {
    const dependencies = createFakeRuntimeDependencies()
    const original = task()
    await dependencies.tasks.create(original)
    const prepare = createTaskStreamPreparer(dependencies, {
      allowedOrigins: [ORIGIN],
      pollIntervalMs: 1,
      sleep: async () => {},
    })
    const prepared = await prepare({
      headers: { authorization: 'Bearer fixture', origin: ORIGIN },
      method: 'GET',
      path: '/v1/tasks/task_sse_fixture_001/events',
    })
    if (prepared.kind !== 'stream')
      throw new Error('Expected stream preparation')
    const transport = new MemorySseTransport()
    transport.disconnect()

    await prepared.start(transport)

    await expect(dependencies.tasks.get(original.id)).resolves.toEqual(original)
  })

  it('emits a heartbeat without advancing the resumable cursor', async () => {
    const dependencies = createFakeRuntimeDependencies()
    await dependencies.tasks.create(task())
    const prepare = createTaskStreamPreparer(dependencies, {
      allowedOrigins: [ORIGIN],
      heartbeatIntervalMs: 2,
      pollIntervalMs: 1,
      sleep: async () => {},
    })
    const prepared = await prepare({
      headers: { authorization: 'Bearer fixture', origin: ORIGIN },
      method: 'GET',
      path: '/v1/tasks/task_sse_fixture_001/events',
    })
    if (prepared.kind !== 'stream')
      throw new Error('Expected stream preparation')
    let closed = false
    const events: SseEvent[] = []
    const transport: SseTransport = {
      get closed() {
        return closed
      },
      end: (event) => {
        events.push(event)
        closed = true
      },
      on: () => {},
      send: (event) => {
        events.push(event)
        if (event.event === 'heartbeat')
          closed = true
        return true
      },
    }

    await prepared.start(transport)

    expect(events.map(event => event.event)).toEqual(['state.snapshot', 'heartbeat'])
    const snapshot = JSON.parse(events[0]!.data) as { cursor: string }
    const heartbeat = JSON.parse(events[1]!.data) as { cursor: string }
    expect(heartbeat.cursor).toBe(snapshot.cursor)
  })

  it('replays a terminal event with the same id after a completed cursor reconnects', () => {
    const completed = task({ status: 'completed', billingStatus: 'settled', version: 4 })
    const first = projectTaskEvents(completed, [])
    const terminal = first.events.at(-1)!
    const resumed = projectTaskEvents(completed, [], terminal.cursor)

    expect(resumed.events).toEqual([])
    expect(projectTaskEvents(completed, []).events.at(-1)?.id).toBe(terminal.id)
  })

  it('projects settled usage and points without provider request details', () => {
    const completed = task({
      status: 'completed',
      billingStatus: 'settled',
      chargedMicroPoints: 7,
      version: 4,
    })
    const projection = projectTaskEvents(completed, [{
      taskId: completed.id,
      uid: completed.uid,
      appId: completed.appId!,
      capability: completed.capability!,
      attempt: 1,
      providerGroup: 'cloudbase',
      model: 'deepseek-v4-flash',
      providerRequestId: 'provider-secret-fixture',
      usage: { inputTokens: 3, outputTokens: 4, cachedInputTokens: 1, reasoningTokens: 0 },
      pricing: {
        version: 'pricing_fixture_v1',
        billingUnit: 1,
        inputMicroCnyPerUnit: 1,
        outputMicroCnyPerUnit: 1,
        userRateBps: 10_000,
        fixedCapabilityFeeMicroPoints: 0,
        minimumChargeMicroPoints: 0,
      },
      providerCostMicroCny: 7,
      userChargeMicroPoints: 7,
      billingResponsibility: 'user',
      outcome: 'success',
      createdAt: 103,
    }])
    const serialized = JSON.stringify(projection.events)

    expect(projection.events.map(event => event.event.type)).toEqual([
      'state.snapshot',
      'usage.settled',
      'run.finished',
    ])
    expect(projection.events[0]).toMatchObject({
      event: {
        task: {
          usage: { totalTokens: 8 },
        },
      },
    })
    expect(serialized).not.toContain('provider-secret-fixture')
  })
})
