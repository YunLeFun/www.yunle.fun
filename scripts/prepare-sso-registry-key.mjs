#!/usr/bin/env node

import { Buffer } from 'node:buffer'
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import process from 'node:process'

function option(name, fallback = '') {
  const prefix = `--${name}=`
  const value = process.argv.slice(2).find(argument => argument.startsWith(prefix))
  return value ? value.slice(prefix.length) : fallback
}

const environment = option('environment')
if (!['development', 'production'].includes(environment))
  throw new Error('--environment must be development or production')
const output = resolve(process.cwd(), option('output', `.env.sso-${environment}.local`))
if (existsSync(output))
  throw new Error(`Refusing to overwrite existing key material: ${output}`)

const date = new Date().toISOString().slice(0, 10).replaceAll('-', '')
const keyId = `${environment}-registry-${date}`
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const privatePem = privateKey.export({ format: 'pem', type: 'pkcs8' })
const privateBase64 = Buffer.from(privatePem).toString('base64')
const ciToken = randomBytes(32).toString('base64url')
writeFileSync(output, [
  `SSO_REGISTRY_SIGNING_KEY=${privateBase64}`,
  `SSO_REGISTRY_SIGNING_KID=${keyId}`,
  `SSO_REGISTRY_CI_TOKEN=${ciToken}`,
  '',
].join('\n'), { flag: 'wx', mode: 0o600 })

console.log(JSON.stringify({
  environment,
  keyId,
  publicJwk: publicKey.export({ format: 'jwk' }),
  secretFile: output,
}, null, 2))
