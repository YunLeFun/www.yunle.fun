import type {
  RegistryActivationRecord,
  RegistryActiveEnvelope,
  RegistryEnvironment,
  RegistryPublicKey,
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

export function registrySnapshotSigningJson(snapshot: Omit<RegistrySnapshotRecord, 'signature'>): string {
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

export function registryActivationSigningJson(activation: Omit<RegistryActivationRecord, 'activationSignature'>): string {
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

export function signRegistrySnapshot(snapshot: Omit<RegistrySnapshotRecord, 'signature'>, key: RegistryKeyInput): string {
  return sign(null, Buffer.from(`${SNAPSHOT_DOMAIN}${registrySnapshotSigningJson(snapshot)}`), privateKey(key)).toString('base64url')
}

export function signRegistryActivation(activation: Omit<RegistryActivationRecord, 'activationSignature'>, key: RegistryKeyInput): string {
  return sign(null, Buffer.from(`${ACTIVATION_DOMAIN}${registryActivationSigningJson(activation)}`), privateKey(key)).toString('base64url')
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

export function verifyRegistryActivationSignature(activation: RegistryActivationRecord, key: RegistryKeyInput): boolean {
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
