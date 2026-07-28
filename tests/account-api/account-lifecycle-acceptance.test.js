import { describe, expect, it, vi } from 'vitest'

import {
  ACCEPTANCE_ACTION,
  createAcceptanceSignature,
  createAcceptanceStore,
  sendAcceptanceEmail,
} from '../../cloudfunctions/account-lifecycle-notifier/acceptance.js'
import { loadEmailConfig } from '../../cloudfunctions/account-lifecycle-notifier/config.js'
import {
  buildAcceptanceEvent,
  invokeAcceptance,
} from '../../scripts/send-ses-acceptance.mjs'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = Date.UTC(2026, 6, 28, 9)
const SIGNING_KEY = 'acceptance-test-key-with-at-least-32-bytes'
const CONFIG = {
  acceptanceEmail: 'i@yunle.fun',
  acceptanceEnabled: true,
  acceptanceSigningKey: SIGNING_KEY,
  opsEmail: 'security@yunle.fun',
}

function signedEvent(overrides = {}) {
  const event = {
    action: ACCEPTANCE_ACTION,
    deadlineAt: Date.UTC(2026, 7, 4, 9),
    issuedAt: NOW,
    runId: 'template-v2-acceptance-20260728',
    type: 'deletion_reminder_7d',
    ...overrides,
  }
  return {
    ...event,
    signature: createAcceptanceSignature(event, SIGNING_KEY),
  }
}

describe('account lifecycle acceptance sending', () => {
  it('验收入口默认关闭，并从独立环境变量读取固定收件箱和签名密钥', () => {
    expect(loadEmailConfig({})).toMatchObject({
      acceptanceEmail: '',
      acceptanceEnabled: false,
      acceptanceSigningKey: '',
    })
    expect(loadEmailConfig({
      SES_ACCEPTANCE_EMAIL: 'acceptance@example.com',
      SES_ACCEPTANCE_ENABLED: 'true',
      SES_ACCEPTANCE_SIGNING_KEY: SIGNING_KEY,
    })).toMatchObject({
      acceptanceEmail: 'acceptance@example.com',
      acceptanceEnabled: true,
      acceptanceSigningKey: SIGNING_KEY,
    })
  })

  it('同一批次重复调用只向 SES 提交一次', async () => {
    const db = makeFakeDb()
    const store = createAcceptanceStore(db)
    const send = vi.fn(async () => ({ id: 'ses-message-1', requestId: 'request-1' }))
    const event = signedEvent()

    const first = await sendAcceptanceEmail(event, { config: CONFIG, now: NOW, send, store })
    const second = await sendAcceptanceEmail(event, { config: CONFIG, now: NOW, send, store })

    expect(first).toMatchObject({
      deduped: false,
      ok: true,
      providerMessageId: 'ses-message-1',
      status: 'submitted',
    })
    expect(second).toMatchObject({
      deduped: true,
      ok: true,
      providerMessageId: 'ses-message-1',
      status: 'submitted',
    })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      id: expect.stringMatching(/^acceptance-[a-f0-9]{48}$/),
      subject: '账号将在 7 天后完成注销',
      to: 'i@yunle.fun',
      type: 'deletion_reminder_7d',
    }))
    expect(db._store.account_lifecycle_acceptance_runs).toEqual([
      expect.objectContaining({
        providerMessageId: 'ses-message-1',
        recipientHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        status: 'submitted',
      }),
    ])
    expect(db._store.account_lifecycle_acceptance_runs[0]).not.toHaveProperty('recipient')
  })

  it('并发提交同一批次时也只有一个调用获得发送资格', async () => {
    const db = makeFakeDb()
    const store = createAcceptanceStore(db)
    let releaseSend
    const sendBlocked = new Promise((resolve) => {
      releaseSend = resolve
    })
    const send = vi.fn(async () => {
      await sendBlocked
      return { id: 'ses-message-concurrent', requestId: 'request-concurrent' }
    })
    const event = signedEvent({ runId: 'concurrent-20260728' })

    const first = sendAcceptanceEmail(event, { config: CONFIG, now: NOW, send, store })
    const second = sendAcceptanceEmail(event, { config: CONFIG, now: NOW, send, store })
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
    releaseSend()

    const results = await Promise.all([first, second])
    expect(results.filter(result => result.deduped)).toHaveLength(1)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['错误签名', { ...signedEvent(), signature: '0'.repeat(64) }],
    ['过期签名', signedEvent({ issuedAt: NOW - 5 * 60 * 1000 - 1 })],
  ])('%s 在占用幂等记录前被拒绝', async (_label, event) => {
    const db = makeFakeDb()
    const store = createAcceptanceStore(db)
    const send = vi.fn()

    await expect(sendAcceptanceEmail(event, {
      config: CONFIG,
      now: NOW,
      send,
      store,
    })).rejects.toThrow(/签名|过期/)
    expect(send).not.toHaveBeenCalled()
    expect(db._store.account_lifecycle_acceptance_runs).toBeUndefined()
  })
})

describe('ses acceptance CLI', () => {
  it('只把短时签名请求交给私有 CloudBase 函数，不传签名密钥或任意收件人', async () => {
    const event = buildAcceptanceEvent({
      deadlineAt: '2026-08-04T17:00:00+08:00',
      runId: 'template-v2-acceptance-20260728',
      type: 'deletion_reminder_7d',
    }, {
      now: NOW,
      signingKey: SIGNING_KEY,
    })
    const run = vi.fn(async () => ({ status: 0 }))

    await invokeAcceptance({
      envId: 'test-env',
      event,
      run,
    })

    expect(event).toMatchObject({
      action: ACCEPTANCE_ACTION,
      deadlineAt: Date.UTC(2026, 7, 4, 9),
      issuedAt: NOW,
      runId: 'template-v2-acceptance-20260728',
      signature: expect.stringMatching(/^[a-f0-9]{64}$/),
      type: 'deletion_reminder_7d',
    })
    expect(run).toHaveBeenCalledWith('tcb', [
      'fn',
      'invoke',
      'account-lifecycle-notifier',
      '--params',
      JSON.stringify(event),
      '-e',
      'test-env',
    ])
    expect(JSON.stringify(run.mock.calls)).not.toContain(SIGNING_KEY)
    expect(JSON.stringify(event)).not.toContain('@')
  })
})
