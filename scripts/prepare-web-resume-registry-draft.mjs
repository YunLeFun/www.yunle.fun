#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DRAFT_DIRECTORY = resolve(ROOT, 'specs/sso-client-registry-platform/drafts')

const environments = {
  development: {
    iconUrl: 'https://resume.yunle.localhost:3455/img/icons/web-resume-mark.svg',
    origin: 'https://resume.yunle.localhost:3455',
    policyVersion: '2026-09-03.1-dev',
    redirectUri: 'https://resume.yunle.localhost:3455/user',
  },
  production: {
    iconUrl: 'https://resume.yunle.fun/img/icons/web-resume-mark.svg',
    origin: 'https://resume.yunle.fun',
    policyVersion: '2026-09-03.1',
    redirectUri: 'https://resume.yunle.fun/user',
  },
}

mkdirSync(DRAFT_DIRECTORY, { recursive: true })
for (const [environment, config] of Object.entries(environments)) {
  const generatedPath = resolve(ROOT, `packages/authorization-core/src/generated/${environment}-registry.json`)
  const artifact = JSON.parse(readFileSync(generatedPath, 'utf8'))
  const client = {
    adapters: [{
      allowedScopes: ['identity:bootstrap'],
      consent: 'trusted',
      kind: 'web-sso',
      origins: [config.origin],
      redirectUris: [config.redirectUri],
    }],
    appId: 'web-resume',
    clientId: 'web-resume-web',
    displayName: 'Web Resume',
    iconUrl: config.iconUrl,
    status: 'active',
  }
  const registry = {
    ...artifact.registry,
    clients: [...artifact.registry.clients.filter(item => item.clientId !== client.clientId), client]
      .sort((left, right) => left.clientId.localeCompare(right.clientId)),
    policyVersion: config.policyVersion,
  }
  const outputPath = resolve(DRAFT_DIRECTORY, `${environment}-web-resume-web.json`)
  writeFileSync(outputPath, `${JSON.stringify(registry, null, 2)}\n`)
  console.log(outputPath)
}
