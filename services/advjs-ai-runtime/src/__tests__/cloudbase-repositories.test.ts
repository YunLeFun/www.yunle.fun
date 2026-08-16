import type {
  CloudBaseCollection,
  CloudBaseDatabase,
  CloudBaseDocumentReference,
  CloudBaseQuery,
  CloudBaseTransaction,
} from '../repositories/cloudbase.js'
import { describe, expect, it } from 'vitest'
import { createBetaPricingSnapshot } from '../domain/pricing.js'
import { createCloudBaseRepositories } from '../repositories/cloudbase.js'

interface StoredDocument {
  _id: string
  [key: string]: unknown
}

interface LessThanOrEqual {
  kind: 'lte'
  value: number
}

function isLessThanOrEqual(value: unknown): value is LessThanOrEqual {
  return Boolean(value && typeof value === 'object' && 'kind' in value && value.kind === 'lte')
}

class FakeDocumentReference implements CloudBaseDocumentReference {
  constructor(
    private readonly documents: Map<string, StoredDocument>,
    private readonly id: string,
  ) {}

  get = async () => ({
    data: this.documents.has(this.id) ? [structuredClone(this.documents.get(this.id))] : [],
  })

  remove = async () => {
    this.documents.delete(this.id)
  }

  set = async (data: object) => {
    if ('_id' in data)
      throw new Error('CloudBase document.set does not allow writing _id')
    this.documents.set(this.id, { ...structuredClone(data), _id: this.id })
  }
}

class FakeQuery implements CloudBaseQuery {
  readonly #conditions: Record<string, unknown>
  readonly #order: readonly [string, 'asc' | 'desc'][]
  readonly #maximum: number
  readonly #offset: number

  constructor(
    private readonly documents: Map<string, StoredDocument>,
    options: {
      conditions?: Record<string, unknown>
      order?: readonly [string, 'asc' | 'desc'][]
      maximum?: number
      offset?: number
    } = {},
  ) {
    this.#conditions = options.conditions ?? {}
    this.#order = options.order ?? []
    this.#maximum = options.maximum ?? 100
    this.#offset = options.offset ?? 0
  }

  where = (conditions: Record<string, unknown>) => new FakeQuery(this.documents, {
    conditions: { ...this.#conditions, ...conditions },
    maximum: this.#maximum,
    offset: this.#offset,
    order: this.#order,
  })

  orderBy = (field: string, direction: 'asc' | 'desc') => new FakeQuery(this.documents, {
    conditions: this.#conditions,
    maximum: this.#maximum,
    offset: this.#offset,
    order: [...this.#order, [field, direction]],
  })

  limit = (maximum: number) => new FakeQuery(this.documents, {
    conditions: this.#conditions,
    maximum,
    offset: this.#offset,
    order: this.#order,
  })

  skip = (offset: number) => new FakeQuery(this.documents, {
    conditions: this.#conditions,
    maximum: this.#maximum,
    offset,
    order: this.#order,
  })

  get = async () => {
    const data = [...this.documents.values()]
      .filter(document => Object.entries(this.#conditions).every(([field, expected]) => {
        const actual = document[field]
        return isLessThanOrEqual(expected) ? Number(actual) <= expected.value : actual === expected
      }))
      .sort((left, right) => {
        for (const [field, direction] of this.#order) {
          const compared = Number(left[field] ?? 0) - Number(right[field] ?? 0)
          if (compared)
            return direction === 'asc' ? compared : -compared
        }
        return 0
      })
      .slice(this.#offset, this.#offset + this.#maximum)
      .map(document => structuredClone(document))
    return { data }
  }
}

class FakeCollection extends FakeQuery implements CloudBaseCollection {
  constructor(private readonly source: Map<string, StoredDocument>) {
    super(source)
  }

  doc = (id: string) => new FakeDocumentReference(this.source, id)
}

class FakeDatabase implements CloudBaseDatabase, CloudBaseTransaction {
  readonly command = {
    lte: (value: number): LessThanOrEqual => ({ kind: 'lte', value }),
  }

  readonly #collections = new Map<string, Map<string, StoredDocument>>()
  #transactionTail = Promise.resolve()

  collection = (name: string) => new FakeCollection(this.#getCollection(name))

  runTransaction = async <T>(operation: (transaction: CloudBaseTransaction) => Promise<T>): Promise<T> => {
    const previous = this.#transactionTail
    let release!: () => void
    this.#transactionTail = new Promise(resolve => release = resolve)
    await previous
    const snapshot: Array<[string, Array<[string, StoredDocument]>]> = structuredClone(
      [...this.#collections.entries()].map(([name, documents]) => [name, [...documents.entries()]]),
    )
    try {
      return await operation(this)
    }
    catch (error) {
      this.#collections.clear()
      for (const [name, entries] of snapshot)
        this.#collections.set(name, new Map(entries))
      throw error
    }
    finally {
      release()
    }
  }

  #getCollection(name: string): Map<string, StoredDocument> {
    const existing = this.#collections.get(name)
    if (existing)
      return existing
    const created = new Map<string, StoredDocument>()
    this.#collections.set(name, created)
    return created
  }
}

describe('cloudBase runtime repositories', () => {
  it('persists tasks and atomically compare-and-sets a lease across repository instances', async () => {
    const database = new FakeDatabase()
    const first = createCloudBaseRepositories(database)
    const second = createCloudBaseRepositories(database)
    await first.tasks.create({
      createdAt: 1,
      id: 'task_fixture_001',
      status: 'queued',
      uid: 'uid_fixture_001',
      version: 0,
    })

    const claims = await Promise.all([
      first.tasks.claimNext({ leaseDurationMs: 1_000, leaseOwner: 'worker_a', now: 100 }),
      second.tasks.claimNext({ leaseDurationMs: 1_000, leaseOwner: 'worker_b', now: 100 }),
    ])

    expect(claims.filter(Boolean)).toHaveLength(1)
    await expect(second.tasks.get('task_fixture_001')).resolves.toMatchObject({
      attempt: 1,
      leaseExpiresAt: 1_100,
      status: 'running',
    })
  })

  it('persists immutable usage attempts and daily budget transactions', async () => {
    const database = new FakeDatabase()
    const repositories = createCloudBaseRepositories(database)
    const pricing = createBetaPricingSnapshot({
      version: 'pricing_fixture_v1',
      billingUnit: 1,
      inputMicroCnyPerUnit: 1,
      outputMicroCnyPerUnit: 1,
    })
    const usage = {
      appId: 'advjs-studio-web',
      attempt: 1,
      billingResponsibility: 'user' as const,
      capability: 'generate-outline' as const,
      createdAt: 100,
      outcome: 'success' as const,
      model: 'deepseek-v4-flash',
      pricing,
      providerCostMicroCny: 2,
      providerGroup: 'cloudbase' as const,
      providerRequestId: 'provider-request-001',
      taskId: 'task_fixture_001',
      uid: 'uid_fixture_001',
      userChargeMicroPoints: 2,
    }

    await repositories.usage.append(usage)
    await expect(repositories.usage.append(usage)).rejects.toThrowError(/usage attempt already exists/i)
    await expect(repositories.usage.append({
      ...usage,
      attempt: 2,
      taskId: 'task_fixture_002',
    })).rejects.toThrowError(/provider request already exists/i)
    await expect(createCloudBaseRepositories(database).usage.listByTask(usage.taskId)).resolves.toMatchObject([usage])

    await repositories.runtimeControl.transactDailyBudget('2026-08-14', current => ({
      document: {
        actualProviderCostMicroCny: 0,
        dateKey: '2026-08-14',
        id: 'budget:2026-08-14',
        operations: {},
        reservations: {},
        reservedProviderCostMicroCny: (current?.reservedProviderCostMicroCny ?? 0) + 10,
        updatedAt: 100,
        version: (current?.version ?? 0) + 1,
      },
      result: true,
    }))
    await expect(createCloudBaseRepositories(database).runtimeControl.getDailyBudget('2026-08-14')).resolves.toMatchObject({
      reservedProviderCostMicroCny: 10,
      version: 1,
    })
  })

  it('atomically deletes only expired resolved task content', async () => {
    const repositories = createCloudBaseRepositories(new FakeDatabase())
    await repositories.tasks.create({
      expiresAt: 100,
      id: 'task_expired_completed',
      status: 'completed',
      uid: 'uid_completed',
    })
    await repositories.tasks.create({
      expiresAt: 100,
      id: 'task_expired_reconcile',
      status: 'reconcile_required',
      uid: 'uid_reconcile',
    })

    await expect(repositories.tasks.deleteExpired('task_expired_completed', 100)).resolves.toBe(true)
    await expect(repositories.tasks.get('task_expired_completed')).resolves.toBeUndefined()
    await expect(repositories.tasks.deleteExpired('task_expired_reconcile', 100)).resolves.toBe(false)
    await expect(repositories.tasks.get('task_expired_reconcile')).resolves.toMatchObject({
      status: 'reconcile_required',
    })
  })
})
