import type { GeneratedRegistryArtifact } from './registry-types'
import developmentArtifactJson from './generated/development-registry.json'
import productionArtifactJson from './generated/production-registry.json'

// Generated artifacts are strictly validated by the authorization-core build.
// Keeping this browser-facing module data-only prevents Node crypto from entering
// the public app bundle; management and compare tooling verify hashes/signatures.
export const productionRegistryArtifact = productionArtifactJson as unknown as GeneratedRegistryArtifact
export const developmentRegistryArtifact = developmentArtifactJson as unknown as GeneratedRegistryArtifact

// P1 authorization remains compile-time static. The optional activeEnvelope is
// only a signed export/compare baseline and is never passed into authorize().
export const productionRegistry = productionRegistryArtifact.registry
export const developmentRegistry = developmentRegistryArtifact.registry
