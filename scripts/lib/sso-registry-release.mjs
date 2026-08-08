function assertReleaseBinding(condition, code) {
  if (!condition)
    throw new Error(code)
}

/** Verify a signed release intent and its active envelope before writing generated files. */
export function createReleaseArtifacts({
  core,
  environment,
  localArtifact,
  releaseIntentId,
  response,
  trustAnchors,
}) {
  const intent = core.verifyRegistryReleaseIntent(response?.intent, { environment, trustAnchors })
  const envelope = core.verifyRegistryActiveEnvelope(response?.envelope, {
    environment,
    minimumGeneration: localArtifact.minimumGeneration,
    trustAnchors,
  })
  assertReleaseBinding(intent.snapshotId === envelope.snapshot.snapshotId, 'release_snapshot_mismatch')
  assertReleaseBinding(intent.generation === envelope.state.generation, 'release_generation_mismatch')
  assertReleaseBinding(intent.policyVersion === envelope.snapshot.policyVersion, 'release_policy_version_mismatch')
  assertReleaseBinding(intent.contentHash === envelope.snapshot.contentHash, 'release_content_hash_mismatch')
  assertReleaseBinding(intent.securityHash === envelope.snapshot.securityHash, 'release_security_hash_mismatch')
  return {
    registryArtifact: {
      formatVersion: 1,
      environment,
      minimumGeneration: envelope.state.generation,
      registry: envelope.snapshot.registry,
      activeEnvelope: envelope,
    },
    releaseManifest: {
      formatVersion: 1,
      environment,
      releaseIntentId,
      intent,
      envelope,
    },
  }
}
