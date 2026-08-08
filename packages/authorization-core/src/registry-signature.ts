import type {
  RegistryActivationRecord,
  RegistryActiveEnvelope,
  RegistryEnvironment,
  RegistryPublicKey,
  RegistryReleaseIntentManifest,
  RegistrySnapshotRecord,
  RegistryTrustAnchors,
} from './registry-types'
import { Buffer } from 'node:buffer'

import {
  createPrivateKey,
  createPublicKey,
  KeyObject,
  sign,
  verify,
} from 'node:crypto'
import { canonicalJson } from './registry-canonical'
import { parseRegistryActiveEnvelope, RegistryValidationError } from './registry-schema'

const SNAPSHOT_DOMAIN = 'yunlefun:sso-registry:snapshot:v1\n'
const ACTIVATION_DOMAIN = 'yunlefun:sso-registry:activation:v1\n'
const RELEASE_INTENT_DOMAIN = 'yunlefun:sso-registry:release-intent:v1\n'

export type RegistryKeyInput = KeyObject | Record<string, string> | string

function privateKey(input: RegistryKeyInput): KeyObject {
  if (typeof input === 'string')
    return createPrivateKey(input)
  if (input instanceof KeyObject)
    return input
  return createPrivateKey({ key: input, format: 'jwk' } as never)
}

function publicKey(input: RegistryKeyInput): KeyObject {
  if (typeof input === 'string')
    return createPublicKey(input)
  if (input instanceof KeyObject)
    return input.type === 'private' ? createPublicKey(input) : input
  return createPublicKey({ key: input, format: 'jwk' } as never)
}

function registrySnapshotSigningJson(snapshot: Omit<RegistrySnapshotRecord, 'signature'>): string {
  return canonicalJson({
    environment: snapshot.environment,
    snapshotId: snapshot.snapshotId,
    sequence: snapshot.sequence,
    schemaVersion: snapshot.schemaVersion,
    policyVersion: snapshot.policyVersion,
    registry: snapshot.registry,
    canonicalJson: snapshot.canonicalJson,
    contentHash: snapshot.contentHash,
    securityHash: snapshot.securityHash,
    keyId: snapshot.keyId,
    sourceDraftId: snapshot.sourceDraftId,
    changeReason: snapshot.changeReason,
    publishedBy: snapshot.publishedBy,
    publishedAt: snapshot.publishedAt,
  })
}

function registryActivationSigningJson(activation: Omit<RegistryActivationRecord, 'activationSignature'>): string {
  return canonicalJson({
    environment: activation.environment,
    generation: activation.generation,
    activeSnapshotId: activation.activeSnapshotId,
    action: activation.action,
    previousSnapshotId: activation.previousSnapshotId,
    activatedBy: activation.activatedBy,
    activatedAt: activation.activatedAt,
    activationKeyId: activation.activationKeyId,
  })
}

function registryReleaseIntentSigningJson(intent: Omit<RegistryReleaseIntentManifest, 'manifestSignature'>): string {
  return canonicalJson({
    environment: intent.environment,
    approvalId: intent.approvalId,
    snapshotId: intent.snapshotId,
    generation: intent.generation,
    policyVersion: intent.policyVersion,
    contentHash: intent.contentHash,
    securityHash: intent.securityHash,
    baseCommitSha: intent.baseCommitSha,
    manifestKeyId: intent.manifestKeyId,
  })
}

export function signRegistrySnapshot(snapshot: Omit<RegistrySnapshotRecord, 'signature'>, key: RegistryKeyInput): string {
  return sign(null, Buffer.from(`${SNAPSHOT_DOMAIN}${registrySnapshotSigningJson(snapshot)}`), privateKey(key)).toString('base64url')
}

export function signRegistryActivation(activation: Omit<RegistryActivationRecord, 'activationSignature'>, key: RegistryKeyInput): string {
  return sign(null, Buffer.from(`${ACTIVATION_DOMAIN}${registryActivationSigningJson(activation)}`), privateKey(key)).toString('base64url')
}

export function signRegistryReleaseIntent(intent: Omit<RegistryReleaseIntentManifest, 'manifestSignature'>, key: RegistryKeyInput): string {
  return sign(null, Buffer.from(`${RELEASE_INTENT_DOMAIN}${registryReleaseIntentSigningJson(intent)}`), privateKey(key)).toString('base64url')
}

function trustedKey(anchors: RegistryTrustAnchors, environment: RegistryEnvironment, keyId: string): RegistryPublicKey {
  const key = anchors[environment][keyId]
  if (!key)
    throw new RegistryValidationError('registry_signature_key_unknown', '$.keyId')
  return key
}

export function verifyRegistrySnapshotSignature(snapshot: RegistrySnapshotRecord, key: RegistryKeyInput): boolean {
  const { signature, ...unsigned } = snapshot
  return verify(
    null,
    Buffer.from(`${SNAPSHOT_DOMAIN}${registrySnapshotSigningJson(unsigned)}`),
    publicKey(key),
    Buffer.from(signature, 'base64url'),
  )
}

function verifyRegistryActivationSignature(activation: RegistryActivationRecord, key: RegistryKeyInput): boolean {
  const { activationSignature, ...unsigned } = activation
  return verify(
    null,
    Buffer.from(`${ACTIVATION_DOMAIN}${registryActivationSigningJson(unsigned)}`),
    publicKey(key),
    Buffer.from(activationSignature, 'base64url'),
  )
}

export function verifyRegistryActiveEnvelope(value: unknown, options: {
  environment: RegistryEnvironment
  minimumGeneration?: number
  trustAnchors: RegistryTrustAnchors
}): RegistryActiveEnvelope {
  const envelope = parseRegistryActiveEnvelope(value, options)
  const snapshotKey = trustedKey(options.trustAnchors, options.environment, envelope.snapshot.keyId)
  const activationKey = trustedKey(options.trustAnchors, options.environment, envelope.state.activationKeyId)
  if (!verifyRegistrySnapshotSignature(envelope.snapshot, snapshotKey))
    throw new RegistryValidationError('registry_signature_invalid', '$.snapshot.signature')
  if (!verifyRegistryActivationSignature(envelope.state, activationKey))
    throw new RegistryValidationError('registry_signature_invalid', '$.state.activationSignature')
  return envelope
}

export function verifyRegistryReleaseIntent(value: unknown, options: {
  environment: RegistryEnvironment
  trustAnchors: RegistryTrustAnchors
}): RegistryReleaseIntentManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new RegistryValidationError('registry_release_intent_invalid', '$')
  const input = value as Record<string, unknown>
  const requiredText = (field: string, pattern?: RegExp): string => {
    const fieldValue = input[field]
    if (typeof fieldValue !== 'string' || !fieldValue || (pattern && !pattern.test(fieldValue)))
      throw new RegistryValidationError('registry_release_intent_invalid', `$.${field}`)
    return fieldValue
  }
  const environment = requiredText('environment')
  if (environment !== options.environment)
    throw new RegistryValidationError('registry_environment_mismatch', '$.environment')
  const approvalId = input.approvalId
  if (approvalId !== null && (typeof approvalId !== 'string' || !approvalId))
    throw new RegistryValidationError('registry_release_intent_invalid', '$.approvalId')
  const generation = input.generation
  if (!Number.isSafeInteger(generation) || Number(generation) <= 0)
    throw new RegistryValidationError('registry_release_intent_invalid', '$.generation')
  const manifest: RegistryReleaseIntentManifest = {
    environment: options.environment,
    approvalId: approvalId as string | null,
    snapshotId: requiredText('snapshotId'),
    generation: Number(generation),
    policyVersion: requiredText('policyVersion'),
    contentHash: requiredText('contentHash', /^[a-f0-9]{64}$/),
    securityHash: requiredText('securityHash', /^[a-f0-9]{64}$/),
    baseCommitSha: requiredText('baseCommitSha', /^[a-f0-9]{40}$/),
    manifestKeyId: requiredText('manifestKeyId'),
    manifestSignature: requiredText('manifestSignature', /^[\w-]+$/),
  }
  const key = trustedKey(options.trustAnchors, options.environment, manifest.manifestKeyId)
  const { manifestSignature, ...unsigned } = manifest
  if (!verify(
    null,
    Buffer.from(`${RELEASE_INTENT_DOMAIN}${registryReleaseIntentSigningJson(unsigned)}`),
    publicKey(key),
    Buffer.from(manifestSignature, 'base64url'),
  )) {
    throw new RegistryValidationError('registry_release_intent_signature_invalid', '$.manifestSignature')
  }
  return manifest
}
