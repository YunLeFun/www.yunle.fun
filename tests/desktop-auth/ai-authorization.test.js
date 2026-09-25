import { Buffer } from 'node:buffer'
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { createEntitlementKeyring, createProofOfPossessionVerifier, deviceJwkThumbprint } from '@yunlefun/authorization-core'
import { describe, expect, it, vi } from 'vitest'
import { authorizeAiRequest } from '../../cloudfunctions/desktop-auth/lib/ai-authorization.js'
import { issueDeviceGrant, revokeDevice } from '../../cloudfunctions/desktop-auth/lib/devices.js'
import { DEVICES_COLLECTION } from '../../cloudfunctions/desktop-auth/lib/validation.js'
import { makeFakeDb } from '../_fixtures/wxpay.mjs'

const NOW = 1_700_000_000_000
const ORIGIN = 'https://runtime.example.test'
const PATH = '/ai/v1/desktop/writing'
const SECRET = 'dedicated-runtime-identity-secret-12345'
const hash = value => createHash('sha256').update(value).digest('base64url')

async function fixture(scopes = ['membership:read', 'ai:writing']) {
  const db = makeFakeDb({}, { rejectDocumentIdWrites: true })
  const signing = generateKeyPairSync('ed25519')
  const installation = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const jwk = installation.publicKey.export({ format: 'jwk' })
  const jkt = deviceJwkThumbprint(jwk)
  const keyring = createEntitlementKeyring({ issuer: 'https://www.yunle.fun', active: { kid: 'test', privateKey: signing.privateKey }, verificationKeys: [], generateJti: randomUUID })
  const grant = { subject: 'user_1', issuer: 'https://www.yunle.fun', clientId: 'cms-desktop', appId: 'cms', scopes, deviceId: jkt, deviceJkt: jkt, registrationFingerprint: 'registry-1' }
  await issueDeviceGrant(db, grant, { now: NOW, generateGrantId: () => 'grant-1' })
  const entitlement = keyring.signMembershipEntitlement({ ...grant, grantId: 'grant-1', now: NOW, ttlSeconds: 3600 })
  function input(overrides = {}, claims = {}, key = installation, token = entitlement) {
    const requestHash = hash('{"action":"catalog"}')
    const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'dpop+jwt', jwk: key.publicKey.export({ format: 'jwk' }) })).toString('base64url')
    const body = Buffer.from(JSON.stringify({ htm: 'POST', htu: ORIGIN + PATH, ath: hash(token), request_hash: requestHash, iat: NOW / 1000, jti: randomUUID(), ...claims })).toString('base64url')
    const signature = sign('sha256', Buffer.from(`${header}.${body}`), { key: key.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url')
    return { serviceToken: SECRET, method: 'POST', path: PATH, entitlement: token, proof: `${header}.${body}.${signature}`, requestHash, ...overrides }
  }
  const options = { now: NOW, serviceToken: SECRET, canonicalOrigin: ORIGIN, keyring, proofVerifier: createProofOfPossessionVerifier(), registry: { reauthorize: vi.fn() }, assertActiveAccount: vi.fn() }
  return { db, grant, input, options }
}

describe('online writing device authorization', () => {
  it('returns the same issuer UID after active account, registry and proof checks', async () => {
    const f = await fixture()
    expect(await authorizeAiRequest(f.db, f.input(), f.options)).toMatchObject({ uid: 'user_1', clientId: 'cms-desktop', appId: 'cms', grantId: 'grant-1', scope: 'ai:writing' })
    expect(f.options.assertActiveAccount).toHaveBeenCalledWith('user_1')
    expect(f.options.registry.reauthorize).toHaveBeenCalledOnce()
  })

  it.each([
    [{ serviceToken: 'wrong' }, {}, 'runtime_service_denied'],
    [{ requestHash: hash('changed article') }, {}, 'proof_binding_invalid'],
    [{}, { ath: hash('another token') }, 'proof_binding_invalid'],
    [{}, { htu: `${ORIGIN}/ai/v1/chat` }, 'proof_target_invalid'],
    [{}, { iat: NOW / 1000 - 301 }, 'proof_expired'],
  ])('rejects changed service credentials, body, token and target bindings', async (overrides, claims, code) => {
    const f = await fixture()
    await expect(authorizeAiRequest(f.db, f.input(overrides, claims), f.options)).rejects.toMatchObject({ code })
  })

  it('does not upgrade a membership-only grant', async () => {
    const f = await fixture(['membership:read'])
    await expect(authorizeAiRequest(f.db, f.input(), f.options)).rejects.toMatchObject({ code: 'ai_scope_required' })
  })

  it('rejects a different device key and a replayed proof', async () => {
    const f = await fixture()
    await expect(authorizeAiRequest(f.db, f.input({}, {}, generateKeyPairSync('ec', { namedCurve: 'P-256' })), f.options)).rejects.toMatchObject({ code: 'entitlement_claims_invalid' })
    const input = f.input()
    await authorizeAiRequest(f.db, input, f.options)
    await expect(authorizeAiRequest(f.db, input, f.options)).rejects.toMatchObject({ code: 'proof_replayed' })
  })

  it('revocation takes effect without waiting for entitlement expiry and reauthorization cannot revive the old grant', async () => {
    const f = await fixture()
    await revokeDevice(f.db, { uid: f.grant.subject, clientId: f.grant.clientId, deviceId: f.grant.deviceId }, { now: NOW + 1 })
    await expect(authorizeAiRequest(f.db, f.input(), f.options)).rejects.toMatchObject({ code: 'grant_revoked' })
    await issueDeviceGrant(f.db, f.grant, { now: NOW + 2, generateGrantId: () => 'grant-2' })
    expect(f.db._store[DEVICES_COLLECTION][0].status).toBe('active')
    await expect(authorizeAiRequest(f.db, f.input(), f.options)).rejects.toMatchObject({ code: 'grant_revoked' })
  })

  it('fails closed when the account is restricted or client registration changes', async () => {
    const f = await fixture()
    f.options.assertActiveAccount.mockRejectedValue(new Error('account restricted'))
    await expect(authorizeAiRequest(f.db, f.input(), f.options)).rejects.toThrow('account restricted')
    f.options.registry.reauthorize.mockImplementation(() => {
      throw new Error('client policy changed')
    })
    await expect(authorizeAiRequest(f.db, f.input(), f.options)).rejects.toThrow('client policy changed')
  })
})
