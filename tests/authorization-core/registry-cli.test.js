import { generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  hashRegistry,
  parseClientRegistrySnapshot,
  signRegistryActivation,
  signRegistryReleaseIntent,
  signRegistrySnapshot,
  verifyRegistryActiveEnvelope,
  verifyRegistryReleaseIntent,
} from '../../packages/authorization-core/src/index'
import { createVerifiedRegistryArtifact } from '../../scripts/lib/sso-registry-artifact.mjs'
import { createReleaseArtifacts } from '../../scripts/lib/sso-registry-release.mjs'
import {
  createFunctionInvokeArgs,
  parseCliJson,
  unwrapFunctionResult,
} from '../../scripts/lib/sso-registry-transport.mjs'

function signedEnvelope(generation = 1) {
  const keys = generateKeyPairSync('ed25519')
  const registry = parseClientRegistrySnapshot({
    schemaVersion: 1,
    policyVersion: '2026-08-08.1',
    issuer: 'https://www.yunle.fun',
    clients: [],
  }, { environment: 'production' })
  const hashes = hashRegistry(registry)
  const keyId = 'registry-cli-test'
  const unsignedSnapshot = {
    environment: 'production',
    snapshotId: 'production:1:registry-cli-test',
    sequence: 1,
    schemaVersion: 1,
    policyVersion: registry.policyVersion,
    registry,
    ...hashes,
    keyId,
    sourceDraftId: 'draft-test',
    changeReason: 'test generation floor',
    publishedBy: 'registry-test',
    publishedAt: 1_785_700_000_000,
  }
  const snapshot = {
    ...unsignedSnapshot,
    signature: signRegistrySnapshot(unsignedSnapshot, keys.privateKey),
  }
  const unsignedState = {
    environment: 'production',
    generation,
    activeSnapshotId: snapshot.snapshotId,
    action: 'publish',
    previousSnapshotId: null,
    activatedBy: 'registry-test',
    activatedAt: 1_785_700_000_000,
    activationKeyId: keyId,
  }
  return {
    envelope: {
      formatVersion: 1,
      snapshot,
      state: {
        ...unsignedState,
        activationSignature: signRegistryActivation(unsignedState, keys.privateKey),
      },
    },
    trustAnchors: {
      production: { [keyId]: keys.publicKey.export({ format: 'jwk' }) },
      development: {},
    },
    keyId,
    privateKey: keys.privateKey,
  }
}

describe('registry CLI artifact export', () => {
  it('lets the server bind a seeded draft to the current active snapshot', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../../scripts/sso-registry.mjs'), 'utf8')
    const seedCommand = source.slice(
      source.indexOf('function seed('),
      source.indexOf('function invokeManagementCommand('),
    )

    expect(seedCommand).toContain('registry: artifact.registry')
    expect(seedCommand).not.toContain('baseSnapshotId: null')
  })

  it('uses the CloudBase CLI 3.6.4 function invocation parameter contract', () => {
    expect(createFunctionInvokeArgs({
      configFile: '/tmp/cloudbaserc.development.json',
      functionName: 'sso-registry-admin',
      payload: { action: 'recordCiProgress', releaseIntentId: 'release:development:1:test' },
    })).toEqual([
      '--package=@cloudbase/cli@3.6.4',
      'dlx',
      'tcb',
      '--config-file',
      '/tmp/cloudbaserc.development.json',
      'fn',
      'invoke',
      'sso-registry-admin',
      '--params',
      '{"action":"recordCiProgress","releaseIntentId":"release:development:1:test"}',
      '--json',
    ])
  })

  it('unwraps the RetMsg envelope emitted by CloudBase CLI 3.6.4', () => {
    const output = `- Loading data...\n${JSON.stringify({
      InvokeResult: 0,
      FunctionRequestId: 'request-test',
      RetMsg: JSON.stringify({
        ok: true,
        data: { draftId: 'draft:test' },
      }),
    })}\n`

    expect(unwrapFunctionResult(parseCliJson(output))).toEqual({ draftId: 'draft:test' })
  })

  it('rejects a failed CloudBase Event Function invocation before parsing RetMsg', () => {
    expect(() => unwrapFunctionResult({
      InvokeResult: 1,
      ErrMsg: 'function execution failed',
      RetMsg: '',
    })).toThrow('Registry admin invocation failed: function execution failed')
  })

  it('rejects an active envelope below the compiled generation floor', () => {
    const { envelope, trustAnchors } = signedEnvelope(1)

    expect(() => createVerifiedRegistryArtifact({
      environment: 'production',
      envelope,
      minimumGeneration: 2,
      trustAnchors,
      verifyRegistryActiveEnvelope,
    })).toThrow(expect.objectContaining({ code: 'registry_activation_replayed' }))
  })

  it('verifies and binds a release intent before generating Registry release files', () => {
    const { envelope, keyId, privateKey, trustAnchors } = signedEnvelope(1)
    const unsignedIntent = {
      environment: 'production',
      approvalId: 'approval:test',
      snapshotId: envelope.snapshot.snapshotId,
      generation: envelope.state.generation,
      policyVersion: envelope.snapshot.policyVersion,
      contentHash: envelope.snapshot.contentHash,
      securityHash: envelope.snapshot.securityHash,
      baseCommitSha: 'e'.repeat(40),
      manifestKeyId: keyId,
    }
    const response = {
      intent: {
        ...unsignedIntent,
        manifestSignature: signRegistryReleaseIntent(unsignedIntent, privateKey),
      },
      envelope,
    }

    expect(createReleaseArtifacts({
      core: { verifyRegistryActiveEnvelope, verifyRegistryReleaseIntent },
      environment: 'production',
      localArtifact: { minimumGeneration: 0 },
      releaseIntentId: 'release:production:1:test',
      response,
      trustAnchors,
    })).toMatchObject({
      registryArtifact: { minimumGeneration: 1 },
      releaseManifest: {
        releaseIntentId: 'release:production:1:test',
        intent: { baseCommitSha: 'e'.repeat(40) },
      },
    })
  })
})
