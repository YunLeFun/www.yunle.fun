/** Build a generated Registry artifact only after enforcing its compiled replay floor. */
export function createVerifiedRegistryArtifact({
  environment,
  envelope,
  minimumGeneration,
  trustAnchors,
  verifyRegistryActiveEnvelope,
}) {
  const verifiedEnvelope = verifyRegistryActiveEnvelope(envelope, {
    environment,
    minimumGeneration,
    trustAnchors,
  })
  return {
    formatVersion: 1,
    environment,
    minimumGeneration: verifiedEnvelope.state.generation,
    registry: verifiedEnvelope.snapshot.registry,
    activeEnvelope: verifiedEnvelope,
  }
}
