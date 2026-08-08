import { generateKeyPairSync } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import { createWorkflowDispatcher } from '../../cloudfunctions/sso-registry-release-dispatcher/github-app.js'
import { runRegistryReleaseDispatch } from '../../cloudfunctions/sso-registry-release-dispatcher/service.js'
import { createDispatcherStore } from '../../cloudfunctions/sso-registry-release-dispatcher/store.js'

function memoryStore(rows) {
  const outbox = new Map(rows.map(row => [row.releaseIntentId, structuredClone(row)]))
  return {
    outbox,
    listReady: async now => [...outbox.values()].filter(row => (
      ['pending', 'retry'].includes(row.status) && row.nextAttemptAt <= now
    ) || (row.status === 'dispatching' && row.leaseExpiresAt <= now)),
    claim: async (releaseIntentId, lease) => {
      const row = outbox.get(releaseIntentId)
      const ready = row && ((['pending', 'retry'].includes(row.status) && row.nextAttemptAt <= lease.updatedAt)
        || (row.status === 'dispatching' && row.leaseExpiresAt <= lease.updatedAt))
      if (!ready)
        return null
      Object.assign(row, { status: 'dispatching', ...lease })
      return structuredClone(row)
    },
    markSent: async (releaseIntentId, leaseOwner, fields) => {
      const row = outbox.get(releaseIntentId)
      if (row.status !== 'dispatching' || row.leaseOwner !== leaseOwner)
        return false
      Object.assign(row, { status: 'sent', ...fields })
      return true
    },
    markFailed: async (releaseIntentId, leaseOwner, fields) => {
      const row = outbox.get(releaseIntentId)
      if (row.status !== 'dispatching' || row.leaseOwner !== leaseOwner)
        return false
      Object.assign(row, fields)
      return true
    },
  }
}

describe('registry release dispatcher', () => {
  it('selects due work after indexed status queries without SDK range commands', async () => {
    const documents = [
      { _id: 'release:pending', status: 'pending', nextAttemptAt: 100 },
      { _id: 'release:future', status: 'pending', nextAttemptAt: 300 },
      { _id: 'release:retry', status: 'retry', nextAttemptAt: 90 },
      { _id: 'release:expired-lease', status: 'dispatching', leaseExpiresAt: 80 },
      { _id: 'release:active-lease', status: 'dispatching', leaseExpiresAt: 250 },
    ]
    const queriedStatuses = []
    const database = {
      command: {},
      collection: () => {
        let status
        let timeField
        let maximum
        return {
          where(filter) {
            status = filter.status
            queriedStatuses.push(status)
            return this
          },
          orderBy(field) {
            timeField = field
            return this
          },
          limit(value) {
            maximum = value
            return this
          },
          async get() {
            return {
              data: documents
                .filter(document => document.status === status)
                .sort((left, right) => left[timeField] - right[timeField])
                .slice(0, maximum),
            }
          },
        }
      },
    }

    await expect(createDispatcherStore(database).listReady(200, 10)).resolves.toEqual([
      expect.objectContaining({ releaseIntentId: 'release:expired-lease' }),
      expect.objectContaining({ releaseIntentId: 'release:retry' }),
      expect.objectContaining({ releaseIntentId: 'release:pending' }),
    ])
    expect(queriedStatuses).toEqual(['pending', 'retry', 'dispatching'])
  })

  it('claims each release intent once and marks a successful workflow dispatch sent', async () => {
    const store = memoryStore([{
      releaseIntentId: 'release:development:1:test',
      status: 'pending',
      attempts: 0,
      nextAttemptAt: 100,
    }])
    const dispatchWorkflow = vi.fn(async () => ({ requestId: 'github-request-1' }))

    await expect(runRegistryReleaseDispatch({
      dispatchWorkflow,
      leaseOwner: 'dispatcher-1',
      now: 100,
      store,
    })).resolves.toEqual({ claimed: 1, dispatched: 1, failed: 0, deadLetter: 0 })
    expect(dispatchWorkflow).toHaveBeenCalledWith({ releaseIntentId: 'release:development:1:test' })
    expect(store.outbox.get('release:development:1:test')).toMatchObject({
      status: 'sent',
      attempts: 1,
      dispatchRequestId: 'github-request-1',
      leaseOwner: null,
    })

    await runRegistryReleaseDispatch({ dispatchWorkflow, leaseOwner: 'dispatcher-2', now: 200, store })
    expect(dispatchWorkflow).toHaveBeenCalledTimes(1)
  })

  it('uses a repository-scoped GitHub App installation token to dispatch only the intent id', async () => {
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'installation-token' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'x-github-request-id': 'github-request-2' }),
      })
    const dispatch = createWorkflowDispatcher({
      appId: '123',
      fetch,
      installationId: '456',
      now: () => 1_785_700_000_000,
      owner: 'YunLeFun',
      privateKey: keys.privateKey.export({ format: 'pem', type: 'pkcs8' }),
      repository: 'www.yunle.fun',
    })

    await expect(dispatch({ releaseIntentId: 'release:development:1:test' }))
      .resolves
      .toEqual({ requestId: 'github-request-2' })
    expect(fetch.mock.calls[1][0]).toBe('https://api.github.com/repos/YunLeFun/www.yunle.fun/actions/workflows/registry-release.yml/dispatches')
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({
      ref: 'main',
      inputs: { releaseIntentId: 'release:development:1:test' },
    })
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer installation-token')
    expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
    expect(fetch.mock.calls[1][1].signal).toBeInstanceOf(AbortSignal)
  })
})
