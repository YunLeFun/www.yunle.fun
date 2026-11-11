import { generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDesktopClientRegistry } from '../../cloudfunctions/desktop-auth/lib/client-registry.js'
import { startDeviceAuth } from '../../cloudfunctions/desktop-auth/lib/device-codes.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const entry = new URL('../../cloudfunctions/desktop-auth/index.js', import.meta.url)
const require = createRequire(entry)
const source = readFileSync(entry, 'utf8')
const signingKey = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' })
const deviceKey = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ format: 'jwk' })

afterEach(() => vi.unstubAllEnvs())

async function harness() {
  const db = makeFakeDb({}, { rejectDocumentIdWrites: true })
  const registry = createDesktopClientRegistry({ issuerEnvironment: 'production' })
  const started = await startDeviceAuth(db, { clientId: 'el-bot-cloud', scope: ['membership:read', 'ai:agent'], devicePublicJwk: deviceKey }, { registry, now: Date.now() - 60_000, ttlSec: 1 })
  vi.stubEnv('DESKTOP_AUTH_SIGNING_KEY', signingKey)
  vi.stubEnv('DESKTOP_AUTH_SIGNING_KID', 'test-key')
  vi.stubEnv('AUTH_ISSUER_ENVIRONMENT', 'production')
  vi.stubEnv('ACCOUNT_API_INTERNAL_TOKEN', 'test-internal-token')
  const cloudbase = {
    SYMBOL_CURRENT_ENV: 'test-env',
    init: () => ({ database: () => db, auth: () => ({ getUserInfo: () => ({ uid: 'test-user' }) }), callFunction: async () => ({ result: { restricted: false, state: 'active' } }) }),
  }
  const exports = {}
  runInNewContext(source, {
    exports,
    require: id => id === '@cloudbase/node-sdk' ? cloudbase : require(id),
    console: { error: vi.fn(), warn: vi.fn() },
  })
  return { main: exports.main, userCode: started.userCode }
}

describe('device consent SDK error results', () => {
  it('returns an expired-code result for an opted-in browser instead of throwing a platform invocation failure', async () => {
    const { main, userCode } = await harness()
    await expect(main({ action: 'describeDevice', userCode, errorFormat: 'result' }))
      .resolves
      .toEqual({ ok: false, error: { code: 'device_code_expired' } })
  })

  it('preserves the existing exception contract for SDK callers that did not opt in', async () => {
    const { main, userCode } = await harness()
    await expect(main({ action: 'describeDevice', userCode })).rejects.toMatchObject({ code: 'device_code_expired' })
  })

  it('does not accept an expired code when approval requests opt in', async () => {
    const { main, userCode } = await harness()
    await expect(main({ action: 'approveDevice', userCode, errorFormat: 'result' }))
      .resolves
      .toEqual({ ok: false, error: { code: 'device_code_expired' } })
  })

  it('keeps HTTP error status codes independent of the SDK option', async () => {
    const { main } = await harness()
    const result = await main({ httpMethod: 'POST', body: '{' })
    expect(result.statusCode).toBe(400)
    expect(JSON.parse(result.body)).toMatchObject({ code: 'invalid_request' })
  })
})
