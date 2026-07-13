import { describe, expect, it } from 'vitest'

import {
  auditAction,
  auditMessageCount,
  auditOutcome,
  auditRequestId,
  buildAuditRecord,
  emitAuditLog,
} from '../../cloudfunctions/ai-gateway/lib/audit-log.js'

describe('ai-gateway privacy-safe audit logging', () => {
  it('keeps only allowlisted metadata', () => {
    const secret = 'Bearer secret-key prompt body'
    const event = {
      action: `chat-${secret}`,
      messages: Array.from({ length: 40 }, () => ({ content: secret, role: 'user' })),
    }
    const result = { code: secret, ok: false }
    const record = buildAuditRecord({
      action: auditAction(event),
      durationMs: 12.6,
      messageCount: auditMessageCount(event),
      outcome: auditOutcome(result),
      requestId: auditRequestId({ requestId: secret }),
    })

    expect(record).toMatchObject({
      action: 'unknown',
      durationMs: 13,
      messageCount: 33,
      outcome: 'error',
    })
    expect(record.requestId).toMatch(/^[0-9a-f-]{36}$/)
    expect(JSON.stringify(record)).not.toContain(secret)
  })

  it('preserves platform request ids and known outcomes', () => {
    expect(auditAction({ action: 'rateLimit' })).toBe('rateLimit')
    expect(auditOutcome({ code: 'rate_limited', ok: true })).toBe('rate_limited')
    expect(auditRequestId({ request_id: 'request-12345678' })).toBe('request-12345678')
  })

  it('does not let logging failures alter request handling', () => {
    expect(() => emitAuditLog(() => {
      throw new Error('logger unavailable')
    }, buildAuditRecord({
      action: 'chat',
      durationMs: 1,
      messageCount: 2,
      outcome: 'success',
      requestId: 'request-12345678',
    }))).not.toThrow()
  })
})
