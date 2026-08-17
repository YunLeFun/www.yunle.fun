import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/ai-runtime/agent-runtime-v1.json'
import {
  parseAgentEventEnvelope,
  parseAgentTaskSnapshot,
  parseCreateTaskRequest,
  parseCreateTaskResponse,
} from '../fixtures/ai-runtime/v1'

describe('adv.js ai runtime v1 contracts', () => {
  it('pins the cross-repository fixture payload', () => {
    expect(createHash('sha256').update(JSON.stringify(fixture)).digest('hex')).toBe(
      '5f42c41fa2844ebfc3593a26c74af39870bd3497710b996dea1a1e5262d8a57c',
    )
  })

  it('accepts the versioned completed-task fixture through public parsers', () => {
    const request = parseCreateTaskRequest(fixture.createRequest)
    const response = parseCreateTaskResponse(fixture.createResponse)
    const events = fixture.events.map(parseAgentEventEnvelope)
    const snapshot = parseAgentTaskSnapshot(fixture.snapshot)

    expect(request.project.files).toEqual({ 'adv/outline.md': '# Fixture\n' })
    expect(response.taskId).toBe('task_fixture_001')
    expect(events.at(-1)?.event.type).toBe('run.finished')
    expect(snapshot.status).toBe('completed')
    expect(snapshot.points.chargedMicroPoints).toBe(12000)
  })

  it('rejects malformed or unsupported task snapshots', () => {
    expect(() => parseAgentTaskSnapshot({
      ...fixture.snapshot,
      protocolVersion: 2,
    })).toThrowError(/protocol version/i)
    expect(() => parseAgentTaskSnapshot({
      ...fixture.snapshot,
      taskId: '',
    })).toThrowError(/taskId/)
  })

  it('ignores fields added by a future compatible producer', () => {
    const event = parseAgentEventEnvelope({
      ...fixture.events[0],
      trace: 'future-field',
    })

    expect(event).toEqual(fixture.events[0])
  })

  it('accepts an empty source file', () => {
    const request = parseCreateTaskRequest({
      ...fixture.createRequest,
      project: {
        ...fixture.createRequest.project,
        files: { 'adv/outline.md': '' },
      },
    })

    expect(request.project.files).toEqual({ 'adv/outline.md': '' })
  })

  it('covers cancellation and failure terminal contracts', () => {
    const cancelled = parseAgentTaskSnapshot(fixture.cancelledSnapshot)
    const failed = parseAgentEventEnvelope(fixture.failedEvent)

    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.usage?.chargedMicroPoints).toBe(4000)
    expect(failed.event.type).toBe('run.failed')
  })
})
