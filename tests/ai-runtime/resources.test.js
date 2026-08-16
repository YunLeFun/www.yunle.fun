import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import process from 'node:process'
import { describe, expect, it } from 'vitest'

import {
  AI_RUNTIME_COLLECTION_MANIFESTS,
} from '../../cloudfunctions/account-api/ai-point-resources.js'
import {
  buildAiRuntimeResourcePlan,
} from '../../scripts/lib/ai-runtime-resource-plan.mjs'

const root = resolve(import.meta.dirname, '../..')
const script = resolve(root, 'scripts/ensure-ai-runtime-resources.mjs')

describe('ai runtime cloudbase resource manifest', () => {
  it('declares exactly five ADMINONLY collections and required query indexes', () => {
    expect(AI_RUNTIME_COLLECTION_MANIFESTS.map(item => item.collection)).toEqual([
      'ai_point_accounts',
      'ai_point_transactions',
      'ai_usage_records',
      'ai_tasks',
      'ai_runtime_control',
    ])
    expect(AI_RUNTIME_COLLECTION_MANIFESTS.every(item => item.access === 'ADMINONLY')).toBe(true)
    expect(AI_RUNTIME_COLLECTION_MANIFESTS.find(item => item.collection === 'ai_point_accounts')?.indexes)
      .toContainEqual(expect.objectContaining({ name: 'user_id_unique', unique: true }))
    expect(AI_RUNTIME_COLLECTION_MANIFESTS.find(item => item.collection === 'ai_usage_records')?.indexes)
      .toContainEqual(expect.objectContaining({ name: 'task_attempt_unique', unique: true }))
    expect(AI_RUNTIME_COLLECTION_MANIFESTS.find(item => item.collection === 'ai_tasks')?.indexes)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'user_status_created' }),
        expect.objectContaining({ name: 'status_lease_expiry' }),
        expect.objectContaining({ name: 'expires_at' }),
      ]))
  })

  it('plans missing resources and reports unsafe index or unknown collection drift', () => {
    const missing = buildAiRuntimeResourcePlan({ remoteCollections: [] })
    expect(missing.safe).toBe(true)
    expect(missing.actions.filter(action => action.kind === 'create_collection')).toHaveLength(5)
    expect(missing.actions.filter(action => action.kind === 'set_access')).toHaveLength(5)
    expect(missing.risks).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'new_server_only_collection' }),
      expect.objectContaining({ kind: 'access_will_be_restricted' }),
    ]))
    expect(missing.rollback).toContainEqual(expect.objectContaining({
      kind: 'never_auto_delete_collection',
    }))

    const drift = buildAiRuntimeResourcePlan({
      remoteCollections: [{
        collection: 'ai_point_accounts',
        access: 'READONLY',
        indexes: [{
          name: 'user_id_unique',
          unique: false,
          fields: [{ field: 'userId', order: 'desc' }],
        }],
      }, {
        collection: 'ai_shadow_unknown',
        access: 'ADMINONLY',
        indexes: [],
      }],
    })
    expect(drift.safe).toBe(false)
    expect(drift.unsafe).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'index_definition_mismatch', collection: 'ai_point_accounts' }),
      expect.objectContaining({ kind: 'unknown_managed_collection', collection: 'ai_shadow_unknown' }),
    ]))
    expect(drift.actions).toContainEqual({
      kind: 'set_access',
      collection: 'ai_point_accounts',
      access: 'ADMINONLY',
    })
  })

  it('defaults to a no-network manifest report', () => {
    const result = spawnSync(process.execPath, [script], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        TENCENTCLOUD_SECRETID: '',
        TENCENTCLOUD_SECRETKEY: '',
      },
    })
    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toMatchObject({
      mode: 'manifest',
      network: false,
      applied: false,
      collections: 5,
    })
  })

  it('refuses apply before network access without exact environment confirmations', () => {
    const missingEnv = spawnSync(process.execPath, [script, '--apply'], {
      cwd: root,
      encoding: 'utf8',
    })
    expect(missingEnv.status).not.toBe(0)
    expect(missingEnv.stderr).toMatch(/--env-id/)

    const productionWithoutGate = spawnSync(process.execPath, [
      script,
      '--apply',
      '--environment=production',
      '--env-id=yunlefun-prod-fixture-123456',
      '--confirm-env=yunlefun-prod-fixture-123456',
      '--instance-id=tnt-fixture',
      '--region=ap-shanghai',
      '--config-file=cloudbaserc.json',
      '--confirm-write=CREATE_ADVJS_AI_RUNTIME_RESOURCES',
    ], { cwd: root, encoding: 'utf8' })
    expect(productionWithoutGate.status).not.toBe(0)
    expect(productionWithoutGate.stderr).toMatch(/confirm-production/)
  })

  it('keeps live inspection read-only and validates its target before network access', () => {
    const missingTarget = spawnSync(process.execPath, [script, '--inspect'], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        TENCENTCLOUD_SECRETID: '',
        TENCENTCLOUD_SECRETKEY: '',
      },
    })
    expect(missingTarget.status).not.toBe(0)
    expect(missingTarget.stderr).toMatch(/--env-id is required with --inspect/)

    const conflictingModes = spawnSync(process.execPath, [script, '--inspect', '--apply'], {
      cwd: root,
      encoding: 'utf8',
    })
    expect(conflictingModes.status).not.toBe(0)
    expect(conflictingModes.stderr).toMatch(/mutually exclusive/)
  })
})
