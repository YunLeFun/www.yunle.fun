#!/usr/bin/env node
/** Offline-only packaging. Does not read credentials, provision resources or deploy. */
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = process.argv[2]
if (!output || process.argv.length !== 3)
  throw new Error('Usage: node scripts/package-iap-sandbox.mjs <new-output-directory>')
const destination = resolve(output)
// Refuse replacement of an existing package; each review artifact is immutable.
await mkdir(destination)
const require = createRequire(import.meta.url)
const { SANDBOX_COLLECTIONS } = require('../cloudfunctions/wxpay-order/lib/iap-sandbox.js')

const manifest = {
  format: 1,
  status: 'local-only-not-deployed',
  handler: 'index.main',
  functions: ['iap-order-sandbox', 'appstore-notify-sandbox'],
  collections: Object.values(SANDBOX_COLLECTIONS),
  requiredServerConfig: ['IAP_SANDBOX_TEST_UIDS', 'APPSTORE_ISSUER_ID', 'APPSTORE_KEY_ID', 'APPSTORE_PRIVATE_KEY', 'APPSTORE_BUNDLE_ID'],
  orderOnlyServerConfig: ['ACCOUNT_API_INTERNAL_TOKEN'],
  prerequisites: ['Create test collections explicitly with server-only permissions', 'Check function name collisions and account-api internal caller access', 'Connect native test wallet reads and reconciliation before use', 'Obtain real Apple Sandbox evidence separately'],
  files: {},
}

async function write(relative, bytes) {
  await mkdir(dirname(join(destination, relative)), { recursive: true })
  await writeFile(join(destination, relative), bytes, { flag: 'wx' })
  manifest.files[relative] = createHash('sha256').update(bytes).digest('hex')
}

async function copyLibrary(relative, functionName) {
  const entries = await readdir(join(root, 'cloudfunctions/wxpay-order/lib', relative), { withFileTypes: true })
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(relative, entry.name)
    if (entry.isDirectory()) {
      await copyLibrary(path, functionName)
    }
    else if (entry.isFile() && /\.(?:js|cer)$/.test(entry.name)) {
      await write(join(functionName, 'lib', path), await readFile(join(root, 'cloudfunctions/wxpay-order/lib', path)))
    }
    else {
      throw new Error(`Unexpected library entry: ${path}`)
    }
  }
}

for (const name of manifest.functions) {
  const source = join(root, 'cloudfunctions', name.replace(/-sandbox$/, ''))
  await write(join(name, 'index.js'), await readFile(join(source, 'sandbox.js')))
  const pkg = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
  await write(join(name, 'package.json'), `${JSON.stringify({ ...pkg, name }, null, 2)}\n`)
  if (name === 'iap-order-sandbox')
    await write(join(name, 'account-access.js'), await readFile(join(source, 'account-access.js')))
  await copyLibrary('', name)
}
await writeFile(join(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
console.warn(`Prepared ${manifest.functions.length} local function packages at ${destination}; nothing deployed.`)
