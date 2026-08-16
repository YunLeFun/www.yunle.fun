import type { AgentCapabilityId, AgentTaskStatus, JsonValue } from '../contracts/v1.js'
import type { RuntimeDependencies } from '../dependencies.js'
import type { RuntimePolicyDocument } from '../domain/budget.js'
import type { RuntimeTaskRecord, RuntimeUsageRecord } from '../domain/task.js'
import type { RuntimeRequest, RuntimeRequestHandler, RuntimeResponse } from './types.js'
import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { RuntimeAuthError } from '../auth/cloudbase-http.js'
import { CapabilityInputError, CapabilitySafetyError } from '../capabilities/errors.js'
import { AGENT_CAPABILITY_IDS, AGENT_PROTOCOL_VERSION, AGENT_TASK_STATUSES, parseCreateTaskRequest } from '../contracts/v1.js'
import { BudgetIdempotencyConflictError, PlatformBudgetExceededError, shanghaiDateKey } from '../domain/budget.js'
import { patchTask, TaskIdempotencyConflictError } from '../domain/task.js'
import { taskSnapshot } from '../sse/task-events.js'
import { RuntimeSweeper } from '../worker/sweeper.js'
import { RuntimeTaskService } from '../worker/task-service.js'

const MAX_REQUEST_BODY_BYTES = 64 * 1_024
const MAX_IDEMPOTENCY_KEY_LENGTH = 128
const MAX_ADMIN_PAGE_SIZE = 100
const MAX_ADMIN_REASON_LENGTH = 500
const ALLOWED_REQUEST_HEADERS = 'Authorization, Content-Type, Idempotency-Key, Last-Event-ID, X-Request-ID'
const FORBIDDEN_CREATE_FIELDS = new Set([
  'uid',
  'userId',
  'model',
  'provider',
  'providerGroup',
  'pricing',
  'pricingVersion',
  'promptVersion',
  'systemPrompt',
])

interface ApiFailureOptions {
  status: number
  code: string
  message: string
  retryable?: boolean
}

class ApiFailure extends Error {
  readonly status: number
  readonly code: string
  readonly retryable: boolean

  constructor(options: ApiFailureOptions) {
    super(options.message)
    this.status = options.status
    this.code = options.code
    this.retryable = options.retryable ?? false
  }
}

export interface RuntimeLogger {
  info: (message: string, meta: Readonly<Record<string, string | number | boolean | undefined>>) => void
}

export interface ServiceIdentity {
  actor: string
}

export interface ServiceAuthVerifier {
  verify: (authorization: string, audience: string) => Promise<ServiceIdentity>
}

export interface RateLimiter {
  consume: (key: string, now: number) => boolean
}

export interface RuntimeApiOptions {
  appId: string
  allowedOrigins: readonly string[]
  adminAuth?: ServiceAuthVerifier
  logger?: RuntimeLogger
  rateLimiter?: RateLimiter
  maxRequestBodyBytes?: number
  staleTaskAfterMs?: number
}

interface RateLimitBucket {
  count: number
  windowStartedAt: number
}

export class InMemoryRateLimiter implements RateLimiter {
  readonly #buckets = new Map<string, RateLimitBucket>()

  constructor(
    private readonly maximum: number,
    private readonly windowMs: number,
  ) {
    if (!Number.isSafeInteger(maximum) || maximum < 1)
      throw new TypeError('Rate limit maximum must be a positive safe integer')
    if (!Number.isSafeInteger(windowMs) || windowMs < 1)
      throw new TypeError('Rate limit window must be a positive safe integer')
  }

  consume(key: string, now: number): boolean {
    const current = this.#buckets.get(key)
    if (!current || now - current.windowStartedAt >= this.windowMs) {
      this.#buckets.set(key, { count: 1, windowStartedAt: now })
      return true
    }
    if (current.count >= this.maximum)
      return false
    current.count += 1
    return true
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function normalizeHeaders(headers: RuntimeRequest['headers']): Record<string, string> {
  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string' && value)
      normalized[key.toLowerCase()] = value
  }
  return normalized
}

function parseBody(body: unknown): unknown {
  if (typeof body !== 'string')
    return body
  try {
    return JSON.parse(body)
  }
  catch {
    throw new ApiFailure({
      status: 400,
      code: 'INVALID_CAPABILITY_INPUT',
      message: 'Request body must be valid JSON',
    })
  }
}

function bodySize(body: unknown): number {
  try {
    return Buffer.byteLength(typeof body === 'string' ? body : JSON.stringify(body ?? null))
  }
  catch {
    throw new ApiFailure({
      status: 400,
      code: 'INVALID_CAPABILITY_INPUT',
      message: 'Request body is invalid',
    })
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(stableJson).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function requestHash(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

function requestId(headers: Record<string, string>, dependencies: RuntimeDependencies): string {
  const provided = headers['x-request-id']
  if (provided && /^[\w.:-]{8,128}$/.test(provided))
    return provided
  return dependencies.ids.generate('request')
}

function idempotencyKey(headers: Record<string, string>): string {
  const value = headers['idempotency-key']?.trim()
  if (!value || value.length > MAX_IDEMPOTENCY_KEY_LENGTH || !/^[\w.:-]+$/.test(value)) {
    throw new ApiFailure({
      status: 400,
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      message: 'A valid Idempotency-Key header is required',
    })
  }
  return value
}

function bearerToken(headers: Record<string, string>): string {
  const matched = /^Bearer (\S+)$/.exec(headers.authorization ?? '')
  if (!matched?.[1]) {
    throw new ApiFailure({
      status: 401,
      code: 'AUTH_REQUIRED',
      message: 'Authentication is required',
    })
  }
  return matched[1]
}

function jsonHeaders(extra: Readonly<Record<string, string>> = {}): Record<string, string> {
  return {
    'content-type': 'application/json; charset=utf-8',
    ...extra,
  }
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': ALLOWED_REQUEST_HEADERS,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-origin': origin,
    'vary': 'Origin',
  }
}

function success(
  status: number,
  data: JsonValue,
  headers: Readonly<Record<string, string>>,
  currentRequestId: string,
): RuntimeResponse {
  return {
    status,
    headers: jsonHeaders({ ...headers, 'x-request-id': currentRequestId }),
    body: {
      protocolVersion: AGENT_PROTOCOL_VERSION,
      data,
      requestId: currentRequestId,
    },
  }
}

function failure(
  error: ApiFailure,
  headers: Readonly<Record<string, string>>,
  currentRequestId: string,
): RuntimeResponse {
  return {
    status: error.status,
    headers: jsonHeaders({ ...headers, 'x-request-id': currentRequestId }),
    body: {
      protocolVersion: AGENT_PROTOCOL_VERSION,
      error: {
        code: error.code,
        message: error.message,
        requestId: currentRequestId,
        retryable: error.retryable,
      },
    },
  }
}

function mappedFailure(error: unknown): ApiFailure {
  if (error instanceof ApiFailure)
    return error
  if (error instanceof RuntimeAuthError) {
    return new ApiFailure({
      status: 401,
      code: 'AUTH_REQUIRED',
      message: 'Authentication is required',
    })
  }
  if (error instanceof CapabilityInputError) {
    return new ApiFailure({
      status: 400,
      code: error.code,
      message: 'Capability input is invalid',
    })
  }
  if (error instanceof CapabilitySafetyError) {
    return new ApiFailure({
      status: 422,
      code: error.code,
      message: 'The request cannot be processed under the current safety policy',
    })
  }
  if (error instanceof TaskIdempotencyConflictError || error instanceof BudgetIdempotencyConflictError) {
    return new ApiFailure({
      status: 409,
      code: 'IDEMPOTENCY_CONFLICT',
      message: 'Idempotency key conflicts with an existing request',
    })
  }
  if (error instanceof PlatformBudgetExceededError) {
    return new ApiFailure({
      status: 429,
      code: 'PLATFORM_DAILY_LIMIT',
      message: 'Today\'s AI test budget is exhausted',
    })
  }
  if (error instanceof Error && /active task/i.test(error.message)) {
    return new ApiFailure({
      status: 409,
      code: 'ACTIVE_TASK_EXISTS',
      message: 'An active AI task already exists',
    })
  }
  if (error instanceof Error && /insufficient/i.test(error.message)) {
    return new ApiFailure({
      status: 402,
      code: 'POINTS_INSUFFICIENT',
      message: 'AI points are insufficient',
    })
  }
  if (error instanceof Error && /disabled/i.test(error.message)) {
    return new ApiFailure({
      status: 503,
      code: 'AI_DISABLED',
      message: 'AI service is currently disabled',
    })
  }
  return new ApiFailure({
    status: 500,
    code: 'INTERNAL_ERROR',
    message: 'The request could not be completed',
    retryable: true,
  })
}

async function publicTaskSnapshot(
  dependencies: RuntimeDependencies,
  task: RuntimeTaskRecord,
): Promise<JsonValue> {
  const usage = await dependencies.usage.listByTask(task.id)
  return JSON.parse(JSON.stringify(taskSnapshot(task, usage))) as JsonValue
}

function publicPolicy(policy: RuntimePolicyDocument): JsonValue {
  return JSON.parse(JSON.stringify(policy)) as JsonValue
}

function requiredAdminReason(value: unknown): string {
  if (typeof value !== 'string')
    throw new ApiFailure({ status: 400, code: 'REASON_REQUIRED', message: 'An operation reason is required' })
  const reason = value.trim()
  if (reason.length < 4 || reason.length > MAX_ADMIN_REASON_LENGTH)
    throw new ApiFailure({ status: 400, code: 'REASON_REQUIRED', message: 'Operation reason must contain 4 to 500 characters' })
  return reason
}

function requiredAdminOperator(value: unknown): string {
  if (typeof value !== 'string')
    throw new ApiFailure({ status: 400, code: 'OPERATOR_REQUIRED', message: 'An operator is required' })
  const operator = value.trim()
  if (!operator || operator.length > 128 || !/^[\w.:-]+$/.test(operator))
    throw new ApiFailure({ status: 400, code: 'OPERATOR_REQUIRED', message: 'Operator is invalid' })
  return operator
}

function parseAdminDate(value: string | null, boundary: 'start' | 'end'): number | undefined {
  if (value === null)
    return undefined
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new ApiFailure({ status: 400, code: 'INVALID_DATE_FILTER', message: 'Date filters must use YYYY-MM-DD' })
  const timestamp = Date.parse(`${value}T${boundary === 'start' ? '00:00:00.000' : '23:59:59.999'}+08:00`)
  if (!Number.isFinite(timestamp))
    throw new ApiFailure({ status: 400, code: 'INVALID_DATE_FILTER', message: 'Date filter is invalid' })
  return timestamp
}

function parseAdminPage(url: URL): { offset: number, limit: number } {
  const rawLimit = url.searchParams.get('limit') ?? '50'
  const rawCursor = url.searchParams.get('cursor') ?? '0'
  if (!/^\d+$/.test(rawLimit) || !/^\d+$/.test(rawCursor))
    throw new ApiFailure({ status: 400, code: 'INVALID_CURSOR', message: 'Pagination is invalid' })
  const limit = Number(rawLimit)
  const offset = Number(rawCursor)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_ADMIN_PAGE_SIZE || !Number.isSafeInteger(offset))
    throw new ApiFailure({ status: 400, code: 'INVALID_CURSOR', message: 'Pagination is invalid' })
  return { limit, offset }
}

function optionalExactFilter(url: URL, name: string, maximum = 128): string | undefined {
  const value = url.searchParams.get(name)?.trim()
  if (!value)
    return undefined
  if (value.length > maximum || !/^[\w.:-]+$/.test(value))
    throw new ApiFailure({ status: 400, code: 'INVALID_TASK_FILTER', message: `${name} filter is invalid` })
  return value
}

function safeUsageTotal(records: readonly RuntimeUsageRecord[], select: (record: RuntimeUsageRecord) => number): number {
  const total = records.reduce((sum, record) => sum + BigInt(select(record)), 0n)
  if (total > BigInt(Number.MAX_SAFE_INTEGER))
    throw new ApiFailure({ status: 500, code: 'USAGE_OVERFLOW', message: 'Usage aggregate exceeds the safe integer range' })
  return Number(total)
}

function aggregateAdminUsage(records: readonly RuntimeUsageRecord[]) {
  return {
    inputTokens: safeUsageTotal(records, record => record.usage?.inputTokens ?? 0),
    outputTokens: safeUsageTotal(records, record => record.usage?.outputTokens ?? 0),
    cachedInputTokens: safeUsageTotal(records, record => record.usage?.cachedInputTokens ?? 0),
    reasoningTokens: safeUsageTotal(records, record => record.usage?.reasoningTokens ?? 0),
    providerCostMicroCny: safeUsageTotal(records, record => record.providerCostMicroCny),
    userChargeMicroPoints: safeUsageTotal(records, record => record.userChargeMicroPoints),
    attempts: records.length,
  }
}

async function adminTask(dependencies: RuntimeDependencies, task: RuntimeTaskRecord): Promise<JsonValue> {
  const usage = aggregateAdminUsage(await dependencies.usage.listByTask(task.id))
  return {
    taskId: task.id,
    requestId: task.clientRequestId ?? task.id,
    uid: task.uid,
    appId: task.appId ?? '',
    capability: task.capability ?? 'generate-outline',
    status: task.status,
    billingStatus: task.billingStatus ?? 'none',
    providerGroup: task.providerGroup ?? 'cloudbase',
    model: task.model ?? '',
    usage,
    reservedMicroPoints: task.reservedMicroPoints ?? 0,
    chargedMicroPoints: task.chargedMicroPoints ?? usage.userChargeMicroPoints,
    providerCostMicroCny: task.providerCostMicroCny ?? usage.providerCostMicroCny,
    attempt: task.attempt ?? 0,
    createdAt: task.createdAt ?? 0,
    updatedAt: task.updatedAt ?? 0,
    completedAt: task.completedAt ?? 0,
    ...(task.errorCode ? { errorCode: task.errorCode } : {}),
    ...(task.reconcileRequestedAt
      ? {
          reconcile: {
            requestedAt: task.reconcileRequestedAt,
            requestedBy: task.reconcileRequestedBy ?? '',
            serviceActor: task.reconcileServiceActor ?? '',
            reason: task.reconcileReason ?? '',
          },
        }
      : {}),
  }
}

interface AdminTaskFilters {
  status?: AgentTaskStatus
  capability?: AgentCapabilityId
  uid?: string
  appId?: string
  model?: string
  from?: number
  to?: number
}

function parseAdminTaskFilters(url: URL): AdminTaskFilters {
  const status = optionalExactFilter(url, 'status')
  if (status && !AGENT_TASK_STATUSES.includes(status as AgentTaskStatus))
    throw new ApiFailure({ status: 400, code: 'INVALID_TASK_FILTER', message: 'status filter is invalid' })
  const capability = optionalExactFilter(url, 'capability')
  if (capability && !AGENT_CAPABILITY_IDS.includes(capability as AgentCapabilityId))
    throw new ApiFailure({ status: 400, code: 'INVALID_TASK_FILTER', message: 'capability filter is invalid' })
  const from = parseAdminDate(url.searchParams.get('from'), 'start')
  const to = parseAdminDate(url.searchParams.get('to'), 'end')
  if (from !== undefined && to !== undefined && from > to)
    throw new ApiFailure({ status: 400, code: 'INVALID_DATE_FILTER', message: 'from must not be after to' })
  const uid = optionalExactFilter(url, 'uid')
  const appId = optionalExactFilter(url, 'appId')
  const model = optionalExactFilter(url, 'model')
  return {
    ...(status ? { status: status as AgentTaskStatus } : {}),
    ...(capability ? { capability: capability as AgentCapabilityId } : {}),
    ...(uid ? { uid } : {}),
    ...(appId ? { appId } : {}),
    ...(model ? { model } : {}),
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
  }
}

function taskMatchesAdminFilters(task: RuntimeTaskRecord, filters: AdminTaskFilters): boolean {
  const createdAt = task.createdAt ?? 0
  return (!filters.status || task.status === filters.status)
    && (!filters.capability || task.capability === filters.capability)
    && (!filters.uid || task.uid === filters.uid)
    && (!filters.appId || task.appId === filters.appId)
    && (!filters.model || task.model === filters.model)
    && (filters.from === undefined || createdAt >= filters.from)
    && (filters.to === undefined || createdAt <= filters.to)
}

function ensureCreateFieldsAreServerControlled(body: Record<string, unknown>): void {
  const forbidden = Object.keys(body).find(key => FORBIDDEN_CREATE_FIELDS.has(key))
  if (forbidden) {
    throw new ApiFailure({
      status: 400,
      code: 'INVALID_CAPABILITY_INPUT',
      message: `Client cannot control ${forbidden}`,
    })
  }
  const nested = findForbiddenControlField(body.input)
  if (nested) {
    throw new ApiFailure({
      status: 400,
      code: 'INVALID_CAPABILITY_INPUT',
      message: `Capability input cannot control ${nested}`,
    })
  }
}

function findForbiddenControlField(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = findForbiddenControlField(item)
      if (nested)
        return nested
    }
    return undefined
  }
  if (!isRecord(value))
    return undefined
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_CREATE_FIELDS.has(key))
      return key
    const nested = findForbiddenControlField(item)
    if (nested)
      return nested
  }
  return undefined
}

function findCapability(
  dependencies: RuntimeDependencies,
  capability: AgentCapabilityId,
) {
  const definition = dependencies.capabilities.get(capability)
  if (!definition) {
    throw new ApiFailure({
      status: 400,
      code: 'INVALID_CAPABILITY_INPUT',
      message: 'Capability is not registered',
    })
  }
  return definition
}

export function createRuntimeApiHandler(
  dependencies: RuntimeDependencies,
  options: RuntimeApiOptions,
): RuntimeRequestHandler {
  const allowedOrigins = new Set(options.allowedOrigins)
  const taskService = new RuntimeTaskService(dependencies)
  const rateLimiter = options.rateLimiter ?? new InMemoryRateLimiter(60, 60_000)
  const logger = options.logger ?? { info: () => {} }

  return async (request) => {
    const headers = normalizeHeaders(request.headers)
    const currentRequestId = requestId(headers, dependencies)
    const method = request.method.toUpperCase()
    const url = new URL(request.path, 'https://runtime.invalid')
    const path = url.pathname
    const origin = headers.origin ?? ''
    const externalCors = allowedOrigins.has(origin) ? corsHeaders(origin) : {}
    let response: RuntimeResponse
    let uid: string | undefined

    try {
      if (path === '/health' && method === 'GET') {
        response = success(200, {
          ok: true,
          protocolVersion: AGENT_PROTOCOL_VERSION,
          service: 'advjs-ai-runtime',
        }, {}, currentRequestId)
      }
      else if (path.startsWith('/internal/v1/')) {
        if (origin) {
          throw new ApiFailure({
            status: 403,
            code: 'ORIGIN_FORBIDDEN',
            message: 'Browser origins cannot call internal APIs',
          })
        }
        if (!options.adminAuth) {
          throw new ApiFailure({
            status: 401,
            code: 'SERVICE_AUTH_REQUIRED',
            message: 'Service authentication is required',
          })
        }
        let serviceIdentity: ServiceIdentity
        try {
          serviceIdentity = await options.adminAuth.verify(headers.authorization ?? '', 'advjs-ai-runtime-admin')
        }
        catch {
          throw new ApiFailure({
            status: 401,
            code: 'SERVICE_AUTH_REQUIRED',
            message: 'Service authentication is required',
          })
        }
        response = await handleInternalRequest(
          dependencies,
          request,
          method,
          path,
          url,
          headers,
          serviceIdentity,
          currentRequestId,
          options.staleTaskAfterMs ?? 5 * 60_000,
        )
      }
      else {
        if (!origin || !allowedOrigins.has(origin)) {
          throw new ApiFailure({
            status: 403,
            code: 'ORIGIN_FORBIDDEN',
            message: 'Request origin is not allowed',
          })
        }
        if (method === 'OPTIONS') {
          response = {
            status: 204,
            headers: { ...externalCors, 'x-request-id': currentRequestId },
            body: null,
          }
        }
        else {
          const maximumBodyBytes = options.maxRequestBodyBytes ?? MAX_REQUEST_BODY_BYTES
          if (bodySize(request.body) > maximumBodyBytes) {
            throw new ApiFailure({
              status: 413,
              code: 'REQUEST_TOO_LARGE',
              message: 'Request body is too large',
            })
          }
          uid = (await dependencies.auth.verifyAccessToken(bearerToken(headers))).uid
          if (!rateLimiter.consume(`${uid}:${method}:${path}`, dependencies.clock.now())) {
            throw new ApiFailure({
              status: 429,
              code: 'RATE_LIMITED',
              message: 'Too many requests',
              retryable: true,
            })
          }
          response = await handleUserRequest(
            dependencies,
            taskService,
            request,
            method,
            path,
            url,
            headers,
            uid,
            options.appId,
            externalCors,
            currentRequestId,
          )
        }
      }
    }
    catch (error) {
      response = failure(mappedFailure(error), externalCors, currentRequestId)
    }

    logger.info('advjs ai runtime request', {
      requestId: currentRequestId,
      method,
      path,
      status: response.status,
      ...(uid ? { uid } : {}),
    })
    return response
  }
}

async function handleUserRequest(
  dependencies: RuntimeDependencies,
  taskService: RuntimeTaskService,
  request: RuntimeRequest,
  method: string,
  path: string,
  url: URL,
  headers: Record<string, string>,
  uid: string,
  appId: string,
  responseHeaders: Readonly<Record<string, string>>,
  currentRequestId: string,
): Promise<RuntimeResponse> {
  if (method === 'POST' && path === '/v1/tasks') {
    if (!headers['content-type']?.toLowerCase().startsWith('application/json')) {
      throw new ApiFailure({
        status: 415,
        code: 'CONTENT_TYPE_REQUIRED',
        message: 'Content-Type must be application/json',
      })
    }
    const rawBody = parseBody(request.body)
    if (!isRecord(rawBody)) {
      throw new ApiFailure({
        status: 400,
        code: 'INVALID_CAPABILITY_INPUT',
        message: 'Request body must be an object',
      })
    }
    ensureCreateFieldsAreServerControlled(rawBody)
    let parsed: ReturnType<typeof parseCreateTaskRequest>
    try {
      parsed = parseCreateTaskRequest(rawBody)
    }
    catch {
      throw new ApiFailure({
        status: 400,
        code: 'INVALID_CAPABILITY_INPUT',
        message: 'Task request is invalid',
      })
    }
    const capability = findCapability(dependencies, parsed.capability)
    let normalizedRequest: ReturnType<typeof capability.normalizeRequest>
    try {
      normalizedRequest = capability.normalizeRequest(parsed.input, parsed.project)
      capability.assertInputSafe(normalizedRequest)
    }
    catch (error) {
      if (error instanceof CapabilitySafetyError)
        throw error
      throw new ApiFailure({
        status: 400,
        code: 'INVALID_CAPABILITY_INPUT',
        message: 'Capability input is invalid',
      })
    }
    const storedRequest = {
      capability: parsed.capability,
      protocolVersion: parsed.protocolVersion,
      locale: parsed.locale,
      input: normalizedRequest.input,
      project: normalizedRequest.project,
    }
    const task = await taskService.create({
      uid,
      appId,
      capability: parsed.capability,
      input: storedRequest as unknown as JsonValue,
      projectId: parsed.project.id,
      projectRevision: parsed.project.revision,
      maxUsage: capability.maxUsage,
      maxAutomaticAttempts: capability.maxAutomaticAttempts,
      idempotencyKey: idempotencyKey(headers),
      requestHash: requestHash(storedRequest),
    })
    return success(201, {
      taskId: task.id,
      status: task.status,
      reservedMicroPoints: task.reservedMicroPoints ?? 0,
      eventsUrl: `/v1/tasks/${encodeURIComponent(task.id)}/events`,
    }, responseHeaders, currentRequestId)
  }

  const cancelMatch = /^\/v1\/tasks\/([\w.-]+)\/cancel$/.exec(path)
  if (method === 'POST' && cancelMatch?.[1]) {
    idempotencyKey(headers)
    const task = await dependencies.tasks.get(cancelMatch[1])
    if (!task || task.uid !== uid) {
      throw new ApiFailure({ status: 404, code: 'TASK_NOT_FOUND', message: 'Task was not found' })
    }
    const cancelled = await taskService.cancel(task.id)
    return success(200, await publicTaskSnapshot(dependencies, cancelled), responseHeaders, currentRequestId)
  }

  const taskMatch = /^\/v1\/tasks\/([\w.-]+)$/.exec(path)
  if (method === 'GET' && taskMatch?.[1]) {
    const task = await dependencies.tasks.get(taskMatch[1])
    if (!task || task.uid !== uid) {
      throw new ApiFailure({ status: 404, code: 'TASK_NOT_FOUND', message: 'Task was not found' })
    }
    return success(200, await publicTaskSnapshot(dependencies, task), responseHeaders, currentRequestId)
  }

  if (method === 'GET' && path === '/v1/points/me') {
    const account = await dependencies.accountApi.getAccount(uid)
    return success(200, {
      availableMicroPoints: account.availableMicroPoints,
      reservedMicroPoints: account.reservedMicroPoints,
      chargedMicroPoints: account.chargedMicroPoints ?? 0,
      ...(account.activeTask ? { activeTask: account.activeTask } : {}),
    }, responseHeaders, currentRequestId)
  }

  if (method === 'GET' && path === '/v1/points/me/transactions') {
    const cursor = url.searchParams.get('cursor') ?? undefined
    if (cursor && (cursor.length > 256 || !/^[\w.:-]+$/.test(cursor))) {
      throw new ApiFailure({ status: 400, code: 'INVALID_CURSOR', message: 'Cursor is invalid' })
    }
    const page = await dependencies.accountApi.listTransactions(uid, cursor)
    return success(200, JSON.parse(JSON.stringify(page)) as JsonValue, responseHeaders, currentRequestId)
  }

  throw new ApiFailure({ status: 404, code: 'ROUTE_NOT_FOUND', message: 'Route was not found' })
}

async function handleInternalRequest(
  dependencies: RuntimeDependencies,
  request: RuntimeRequest,
  method: string,
  path: string,
  url: URL,
  headers: Record<string, string>,
  identity: ServiceIdentity,
  currentRequestId: string,
  staleTaskAfterMs: number,
): Promise<RuntimeResponse> {
  if (method === 'GET' && path === '/internal/v1/tasks') {
    const page = parseAdminPage(url)
    const filters = parseAdminTaskFilters(url)
    const matching = (await dependencies.tasks.list())
      .filter(task => taskMatchesAdminFilters(task, filters))
      .sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0) || right.id.localeCompare(left.id))
    const selected = matching.slice(page.offset, page.offset + page.limit)
    const items = await Promise.all(selected.map(task => adminTask(dependencies, task)))
    const nextOffset = page.offset + selected.length
    return success(200, {
      items,
      total: matching.length,
      ...(nextOffset < matching.length ? { nextCursor: String(nextOffset) } : {}),
    }, {}, currentRequestId)
  }

  if (method === 'GET' && path === '/internal/v1/runtime/overview') {
    const dateKey = url.searchParams.get('date') ?? shanghaiDateKey(dependencies.clock.now())
    const from = parseAdminDate(dateKey, 'start')
    const to = parseAdminDate(dateKey, 'end')
    if (from === undefined || to === undefined)
      throw new ApiFailure({ status: 400, code: 'INVALID_DATE_FILTER', message: 'Date filter is invalid' })
    const policy = await dependencies.runtimeControl.getActivePolicy()
    if (!policy)
      throw new ApiFailure({ status: 404, code: 'POLICY_NOT_FOUND', message: 'Runtime policy was not found' })
    const tasks = (await dependencies.tasks.list())
      .filter(task => (task.createdAt ?? 0) >= from && (task.createdAt ?? 0) <= to)
    const usageRecords = (await Promise.all(tasks.map(task => dependencies.usage.listByTask(task.id)))).flat()
    const usage = aggregateAdminUsage(usageRecords)
    const budget = await dependencies.runtimeControl.getDailyBudget(dateKey)
    const statusCounts = Object.fromEntries(AGENT_TASK_STATUSES.map(status => [status, 0])) as Record<AgentTaskStatus, number>
    for (const task of tasks)
      statusCounts[task.status] += 1
    const reservedProviderCostMicroCny = budget?.reservedProviderCostMicroCny ?? 0
    const actualProviderCostMicroCny = budget?.actualProviderCostMicroCny ?? 0
    const remainingProviderCostMicroCny = Math.max(
      0,
      policy.globalDailyProviderCapMicroCny - reservedProviderCostMicroCny - actualProviderCostMicroCny,
    )
    return success(200, {
      dateKey,
      policy: publicPolicy(policy),
      access: {
        betaOnly: policy.betaOnly,
        mode: 'ai-point-grant',
        initialGrantMicroPoints: policy.initialGrantMicroPoints,
      },
      budget: {
        capMicroCny: policy.globalDailyProviderCapMicroCny,
        reservedProviderCostMicroCny,
        actualProviderCostMicroCny,
        remainingProviderCostMicroCny,
      },
      tasks: {
        total: tasks.length,
        reconcileQueue: statusCounts.reconcile_required,
        statusCounts,
      },
      usage,
    }, {}, currentRequestId)
  }

  if (method === 'GET' && path === '/internal/v1/policy') {
    const policy = await dependencies.runtimeControl.getActivePolicy()
    if (!policy)
      throw new ApiFailure({ status: 404, code: 'POLICY_NOT_FOUND', message: 'Runtime policy was not found' })
    return success(200, publicPolicy(policy), {}, currentRequestId)
  }

  if (method === 'POST' && path === '/internal/v1/policy') {
    const body = parseBody(request.body)
    if (!isRecord(body))
      throw new ApiFailure({ status: 400, code: 'INVALID_POLICY_UPDATE', message: 'Policy update is invalid' })
    const allowedFields = new Set(['enabled', 'modelEnabled', 'capabilities', 'operator', 'reason'])
    if (Object.keys(body).some(key => !allowedFields.has(key))
      || (body.enabled === undefined && body.modelEnabled === undefined && body.capabilities === undefined)) {
      throw new ApiFailure({ status: 400, code: 'INVALID_POLICY_UPDATE', message: 'Policy update is invalid' })
    }
    const operationKey = idempotencyKey(headers)
    const reason = requiredAdminReason(body.reason)
    const operator = requiredAdminOperator(body.operator)
    const updateFingerprint = requestHash({
      action: 'update-policy',
      enabled: body.enabled,
      modelEnabled: body.modelEnabled,
      capabilities: body.capabilities,
      reason,
      operator,
    })
    const current = await dependencies.runtimeControl.getActivePolicy()
    if (!current)
      throw new ApiFailure({ status: 404, code: 'POLICY_NOT_FOUND', message: 'Runtime policy was not found' })
    if (current.updateIdempotencyKey === operationKey) {
      if (current.updateFingerprint !== updateFingerprint)
        throw new TaskIdempotencyConflictError()
      return success(200, publicPolicy(current), {}, currentRequestId)
    }
    const capabilities = { ...current.capabilities }
    if (body.capabilities !== undefined) {
      if (!isRecord(body.capabilities))
        throw new ApiFailure({ status: 400, code: 'INVALID_POLICY_UPDATE', message: 'Capabilities update is invalid' })
      if (Object.keys(body.capabilities).some(id => !AGENT_CAPABILITY_IDS.includes(id as AgentCapabilityId)))
        throw new ApiFailure({ status: 400, code: 'INVALID_POLICY_UPDATE', message: 'Capability switch is invalid' })
      for (const id of AGENT_CAPABILITY_IDS) {
        const enabled = body.capabilities[id]
        if (enabled !== undefined && typeof enabled !== 'boolean')
          throw new ApiFailure({ status: 400, code: 'INVALID_POLICY_UPDATE', message: 'Capability switch is invalid' })
        if (typeof enabled === 'boolean')
          capabilities[id] = enabled
      }
    }
    const enabled = body.enabled === undefined ? current.enabled : body.enabled
    const modelEnabled = body.modelEnabled === undefined ? current.modelEnabled : body.modelEnabled
    if (typeof enabled !== 'boolean' || typeof modelEnabled !== 'boolean')
      throw new ApiFailure({ status: 400, code: 'INVALID_POLICY_UPDATE', message: 'Policy switches are invalid' })
    const next: RuntimePolicyDocument = {
      ...current,
      enabled,
      modelEnabled,
      capabilities,
      version: `runtime-${dependencies.clock.now()}`,
      updatedBy: operator,
      updateServiceActor: identity.actor,
      updateReason: reason,
      updateIdempotencyKey: operationKey,
      updateFingerprint,
      updatedAt: dependencies.clock.now(),
    }
    await dependencies.runtimeControl.setActivePolicy(next)
    return success(200, publicPolicy(next), {}, currentRequestId)
  }

  const reconcileMatch = /^\/internal\/v1\/tasks\/([\w.-]+)\/reconcile$/.exec(path)
  if (method === 'POST' && reconcileMatch?.[1]) {
    const body = parseBody(request.body)
    if (!isRecord(body))
      throw new ApiFailure({ status: 400, code: 'INVALID_RECONCILE_REQUEST', message: 'Reconcile request is invalid' })
    if (Object.keys(body).some(key => key !== 'operator' && key !== 'reason'))
      throw new ApiFailure({ status: 400, code: 'INVALID_RECONCILE_REQUEST', message: 'Reconcile request is invalid' })
    const operationKey = idempotencyKey(headers)
    const reason = requiredAdminReason(body.reason)
    const operator = requiredAdminOperator(body.operator)
    const reconcileFingerprint = requestHash({ action: 'request-reconcile', taskId: reconcileMatch[1], reason, operator })
    const task = await dependencies.tasks.get(reconcileMatch[1])
    if (!task || task.status !== 'reconcile_required')
      throw new ApiFailure({ status: 404, code: 'TASK_NOT_FOUND', message: 'Reconcile task was not found' })
    if (task.reconcileIdempotencyKey === operationKey) {
      if (task.reconcileFingerprint !== reconcileFingerprint)
        throw new TaskIdempotencyConflictError()
      return success(202, await adminTask(dependencies, task), {}, currentRequestId)
    }
    const queued = await dependencies.tasks.update(task.id, current => patchTask(current, dependencies.clock.now(), {
      reconcileRequestedAt: dependencies.clock.now(),
      reconcileRequestedBy: operator,
      reconcileServiceActor: identity.actor,
      reconcileReason: reason,
      reconcileIdempotencyKey: operationKey,
      reconcileFingerprint,
      errorCode: 'MANUAL_RECONCILE_REQUESTED',
    }))
    return success(202, await adminTask(dependencies, queued), {}, currentRequestId)
  }

  if (method === 'POST' && path === '/internal/v1/runtime/sweep') {
    const result = await new RuntimeSweeper(dependencies, { staleAfterMs: staleTaskAfterMs }).sweep()
    return success(200, result as unknown as JsonValue, {}, currentRequestId)
  }

  throw new ApiFailure({ status: 404, code: 'ROUTE_NOT_FOUND', message: 'Route was not found' })
}
