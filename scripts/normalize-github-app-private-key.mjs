import { Buffer } from 'node:buffer'
import { createPrivateKey } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const PRIVATE_KEY_ENV = 'REGISTRY_RELEASE_APP_PRIVATE_KEY'

export function normalizeGitHubAppPrivateKey(value) {
  const raw = String(value || '').trim()
  if (!raw)
    throw new Error(`${PRIVATE_KEY_ENV} must be configured`)

  const unescaped = raw
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .trim()
  const candidate = unescaped.includes('-----BEGIN ')
    ? unescaped
    : Buffer.from(unescaped, 'base64').toString('utf8').trim()

  try {
    const key = createPrivateKey(candidate)
    if (key.asymmetricKeyType !== 'rsa')
      throw new Error('not an RSA key')
    const pem = key.export({ format: 'pem', type: 'pkcs8' }).toString().trim()
    return pem.replace(/\r?\n/g, '\\n')
  }
  catch {
    throw new Error(`${PRIVATE_KEY_ENV} must be an RSA PEM or base64-encoded RSA PEM`)
  }
}

export function writeGitHubActionsPrivateKey(value, outputPath) {
  if (!outputPath)
    throw new Error('GITHUB_OUTPUT must be configured')
  const privateKey = normalizeGitHubAppPrivateKey(value)
  process.stdout.write(`::add-mask::${privateKey}\n`)
  appendFileSync(outputPath, `private-key=${privateKey}\n`, 'utf8')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeGitHubActionsPrivateKey(
    process.env[PRIVATE_KEY_ENV],
    process.env.GITHUB_OUTPUT,
  )
}
