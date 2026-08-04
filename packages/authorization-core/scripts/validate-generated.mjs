import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ENVIRONMENTS = ['development', 'production']

export function validateGeneratedRegistryArtifacts(artifacts, parseArtifact) {
  for (const environment of ENVIRONMENTS)
    parseArtifact(artifacts[environment], environment)
}

function readGeneratedArtifacts(sourceDirectory) {
  return Object.fromEntries(ENVIRONMENTS.map(environment => [
    environment,
    JSON.parse(readFileSync(resolve(sourceDirectory, `${environment}-registry.json`), 'utf8')),
  ]))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const require = createRequire(import.meta.url)
  const { parseGeneratedRegistryArtifact } = require(resolve(packageRoot, 'dist/index.js'))
  validateGeneratedRegistryArtifacts(
    readGeneratedArtifacts(resolve(packageRoot, 'src/generated')),
    parseGeneratedRegistryArtifact,
  )
  console.log('Generated Registry artifacts validated')
}
