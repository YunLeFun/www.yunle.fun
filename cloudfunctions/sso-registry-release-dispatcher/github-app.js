/** Minimal repository-scoped GitHub App workflow dispatcher. */

'use strict'

const { Buffer } = require('node:buffer')
const { createSign } = require('node:crypto')

const API = 'https://api.github.com'
const REQUEST_TIMEOUT_MS = 15_000

function base64url(value) {
  return Buffer.from(value).toString('base64url')
}

function buildAppJwt({ appId, now, privateKey }) {
  const timestamp = Math.floor(now / 1000)
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64url(JSON.stringify({ iat: timestamp - 60, exp: timestamp + 480, iss: String(appId) }))
  const signature = createSign('RSA-SHA256').update(`${header}.${payload}`).sign(privateKey).toString('base64url')
  return `${header}.${payload}.${signature}`
}

function headers(token) {
  return {
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'YunLeFun-sso-registry-release-dispatcher',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

function githubError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

function createWorkflowDispatcher({
  appId,
  fetch = globalThis.fetch,
  installationId,
  now = Date.now,
  owner,
  privateKey,
  repository,
}) {
  if (!appId || !installationId || !owner || !privateKey || !repository || typeof fetch !== 'function')
    throw new TypeError('GitHub App dispatcher is not configured')
  return async function dispatch({ releaseIntentId }) {
    if (typeof releaseIntentId !== 'string' || !releaseIntentId)
      throw githubError('release_intent_id_required')
    const jwt = buildAppJwt({ appId, now: now(), privateKey })
    const tokenResponse = await fetch(`${API}/app/installations/${encodeURIComponent(installationId)}/access_tokens`, {
      method: 'POST',
      headers: headers(jwt),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      body: JSON.stringify({
        repositories: [repository],
        permissions: { actions: 'write' },
      }),
    })
    if (!tokenResponse.ok)
      throw githubError(`github_installation_token_${tokenResponse.status}`)
    const tokenPayload = await tokenResponse.json()
    if (typeof tokenPayload?.token !== 'string' || !tokenPayload.token)
      throw githubError('github_installation_token_invalid')
    const response = await fetch(
      `${API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/actions/workflows/registry-release.yml/dispatches`,
      {
        method: 'POST',
        headers: headers(tokenPayload.token),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        body: JSON.stringify({
          ref: 'main',
          inputs: { releaseIntentId },
        }),
      },
    )
    if (!response.ok)
      throw githubError(`github_workflow_dispatch_${response.status}`)
    return { requestId: response.headers?.get?.('x-github-request-id') || null }
  }
}

module.exports = { buildAppJwt, createWorkflowDispatcher }
