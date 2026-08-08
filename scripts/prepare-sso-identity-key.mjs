#!/usr/bin/env node

import { Buffer } from 'node:buffer'
import { generateKeyPairSync } from 'node:crypto'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
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
if (!existsSync(output))
  throw new Error(`Secret file does not exist: ${output}`)

const existing = readFileSync(output, 'utf8')
if (/^SSO_IDENTITY_(?:SIGNING_KEY|SIGNING_KID|PUBLIC_KEYS)=/m.test(existing))
  throw new Error(`Refusing to overwrite existing identity key material: ${output}`)

const date = new Date().toISOString().slice(0, 10).replaceAll('-', '')
const keyId = `${environment}-identity-${date}`
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const privatePem = privateKey.export({ format: 'pem', type: 'pkcs8' })
const privateBase64 = Buffer.from(privatePem).toString('base64')
const publicJwk = publicKey.export({ format: 'jwk' })

appendFileSync(output, [
  `SSO_IDENTITY_SIGNING_KEY=${privateBase64}`,
  `SSO_IDENTITY_SIGNING_KID=${keyId}`,
  'SSO_IDENTITY_PUBLIC_KEYS={}',
  '',
].join('\n'), { mode: 0o600 })

console.log(JSON.stringify({
  environment,
  keyId,
  publicJwk,
  secretFile: output,
}, null, 2))
