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

function cloudbaseDatabase(rows) {
  const outbox = new Map(rows.map(row => [row._id, structuredClone(row)]))
  function collection() {
    let status
    let timeField
    let maximum
    return {
      doc(id) {
        return {
          async get() {
            const document = outbox.get(id)
            return { data: document ? structuredClone(document) : null }
          },
          async update(fields) {
            Object.assign(outbox.get(id), structuredClone(fields))
            return { updated: 1 }
          },
        }
      },
      async get() {
        return {
          data: [...outbox.values()]
            .filter(document => document.status === status)
            .sort((left, right) => left[timeField] - right[timeField])
            .slice(0, maximum)
            .map(document => structuredClone(document)),
        }
      },
      limit(value) {
        maximum = value
        return this
      },
      orderBy(field) {
        timeField = field
        return this
      },
      where(filter) {
        status = filter.status
        return this
      },
    }
  }
  return {
    collection,
    outbox,
    runTransaction: operation => operation({ collection }),
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
    })).resolves.toEqual({ ready: 1, claimed: 1, skipped: 0, dispatched: 1, failed: 0, deadLetter: 0 })
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

  it('handles CloudBase transaction document responses when claiming and completing work', async () => {
    const database = cloudbaseDatabase([{
      _id: 'release:development:1:success',
      status: 'pending',
      attempts: 0,
      nextAttemptAt: 90,
    }, {
      _id: 'release:development:1:retry',
      status: 'retry',
      attempts: 1,
      nextAttemptAt: 100,
    }])
    const dispatchWorkflow = vi.fn(async ({ releaseIntentId }) => {
      if (releaseIntentId.endsWith(':retry'))
        throw Object.assign(new Error('temporary failure'), { code: 'github_unavailable' })
      return { requestId: 'github-request-transaction' }
    })

    await expect(runRegistryReleaseDispatch({
      dispatchWorkflow,
      leaseOwner: 'dispatcher-transaction',
      now: 100,
      store: createDispatcherStore(database),
    })).resolves.toEqual({ ready: 2, claimed: 2, skipped: 0, dispatched: 1, failed: 1, deadLetter: 0 })
    expect(database.outbox.get('release:development:1:success')).toMatchObject({
      status: 'sent',
      attempts: 1,
      dispatchRequestId: 'github-request-transaction',
      leaseOwner: null,
    })
    expect(database.outbox.get('release:development:1:retry')).toMatchObject({
      status: 'retry',
      attempts: 2,
      nextAttemptAt: 60_100,
      lastErrorCode: 'github_unavailable',
      leaseOwner: null,
    })
  })

  it('reports work lost to a concurrent claim without dispatching it', async () => {
    const store = {
      listReady: vi.fn(async () => [{ releaseIntentId: 'release:development:1:raced', attempts: 0 }]),
      claim: vi.fn(async () => null),
    }
    const dispatchWorkflow = vi.fn()

    await expect(runRegistryReleaseDispatch({
      dispatchWorkflow,
      leaseOwner: 'dispatcher-race',
      now: 100,
      store,
    })).resolves.toEqual({ ready: 1, claimed: 0, skipped: 1, dispatched: 0, failed: 0, deadLetter: 0 })
    expect(dispatchWorkflow).not.toHaveBeenCalled()
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
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
      repositories: ['www.yunle.fun'],
      permissions: { actions: 'write' },
    })
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer installation-token')
    expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
    expect(fetch.mock.calls[1][1].signal).toBeInstanceOf(AbortSignal)
  })
})
