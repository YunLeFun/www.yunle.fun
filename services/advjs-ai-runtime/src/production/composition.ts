import type { RuntimeApiOptions, RuntimeLogger } from '../api/runtime-api.js'
import type { Clock, IdGenerator, RuntimeDependencies } from '../dependencies.js'
import type { CloudBaseDatabase } from '../repositories/cloudbase.js'
import type { ProductionRuntimeConfig } from './config.js'
import { createHash, randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import process from 'node:process'
import cloudbase from '@cloudbase/node-sdk'
import { AccountApiClient } from '../adapters/account-api.js'
import { CloudBaseAuthHttpVerifier } from '../auth/cloudbase-http.js'
import { StaticBearerServiceAuthVerifier } from '../auth/service-bearer.js'
import { createServerCapabilityRegistry } from '../capabilities/server-registry.js'
import { createCloudBaseModelExecutor } from '../executors/cloudbase-model.js'
import { createCloudBaseRepositories } from '../repositories/cloudbase.js'
import { RuntimeSweeper } from '../worker/sweeper.js'
import { RuntimeWorker } from '../worker/worker.js'
import { RuntimeBackgroundLoop } from './lifecycle.js'

export interface ProductionRuntimeComposition {
  dependencies: RuntimeDependencies
  apiOptions: RuntimeApiOptions
  background: RuntimeBackgroundLoop
}

function uidDigest(uid: string): string {
  return createHash('sha256').update(uid).digest('hex').slice(0, 16)
}

function productionLogger(): RuntimeLogger {
  return {
    info(message, meta) {
      const { uid, ...safeMeta } = meta
      process.stdout.write(`${JSON.stringify({
        level: 'info',
        message,
        ...safeMeta,
        ...(typeof uid === 'string' ? { uidHash: uidDigest(uid) } : {}),
      })}\n`)
    },
  }
}

function lifecycleError(activity: 'worker' | 'sweeper', error: unknown): void {
  process.stderr.write(`${JSON.stringify({
    level: 'error',
    message: 'advjs ai runtime background activity failed',
    activity,
    errorType: error instanceof Error ? error.name : 'UnknownError',
  })}\n`)
}

export function createProductionRuntime(config: ProductionRuntimeConfig): ProductionRuntimeComposition {
  const app = cloudbase.init({ env: config.envId })
  const database = app.database() as unknown as CloudBaseDatabase
  const repositories = createCloudBaseRepositories(database)
  const clock: Clock = { now: () => Date.now() }
  const ids: IdGenerator = {
    generate(prefix) {
      return `${prefix}_${randomUUID().replaceAll('-', '')}`
    },
  }
  const accountApi = new AccountApiClient({
    activeTaskTtlMs: config.activeTaskTtlMs,
    appId: config.billingAppId,
    clock,
    invoke: async (input) => {
      const response = await app.callFunction<Record<string, unknown>, unknown>({
        name: 'account-api',
        data: input,
      })
      return response.result
    },
    scope: config.scope,
    serviceToken: config.accountApiToken,
  })
  const dependencies: RuntimeDependencies = {
    clock,
    ids,
    auth: new CloudBaseAuthHttpVerifier({ envId: config.envId }),
    accountApi,
    tasks: repositories.tasks,
    usage: repositories.usage,
    runtimeControl: repositories.runtimeControl,
    modelExecutor: createCloudBaseModelExecutor({ env: config.envId }),
    capabilities: createServerCapabilityRegistry(),
  }
  const logger = productionLogger()
  const worker = new RuntimeWorker(dependencies, {
    leaseDurationMs: config.leaseDurationMs,
    owner: `${hostname()}:${process.pid}:${randomUUID()}`,
  })
  const sweeper = new RuntimeSweeper(dependencies, {
    staleAfterMs: config.staleTaskAfterMs,
  })
  return {
    dependencies,
    apiOptions: {
      adminAuth: new StaticBearerServiceAuthVerifier({
        actor: 'yunlefun-admin',
        audience: 'advjs-ai-runtime-admin',
        token: config.adminToken,
      }),
      allowedOrigins: config.allowedOrigins,
      appId: config.clientAppId,
      logger,
      staleTaskAfterMs: config.staleTaskAfterMs,
    },
    background: new RuntimeBackgroundLoop(worker, sweeper, {
      onError: lifecycleError,
      sweepIntervalMs: config.sweepIntervalMs,
      workerBatchSize: config.workerBatchSize,
      workerPollMs: config.workerPollMs,
    }),
  }
}
