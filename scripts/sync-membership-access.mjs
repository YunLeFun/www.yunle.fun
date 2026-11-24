#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const source = 'cloudfunctions/wxpay-order/lib/membership-access.js'
const copies = {
  'wxpay-notify': 'membership-access.js',
  'iap-order': 'membership-access.js',
  'appstore-notify': 'membership-access.js',
  'user-storage-api': 'membership.js',
}

export const membershipAccessFunctions = ['wxpay-order', ...Object.keys(copies)]

export function syncMembershipAccess({ checkOnly = false } = {}) {
  const snapshot = readFileSync(join(root, source))
  const { repository, path, sha256 } = JSON.parse(readFileSync(join(root, 'scripts/membership-access.lock.json'), 'utf8'))
  if (repository !== 'YunLeFun/api' || path !== 'cloudfunctions/account-api/membership-access.js'
    || sha256 !== createHash('sha256').update(snapshot).digest('hex')) {
    throw new Error('Membership access snapshot differs from its lock. Export it from YunLeFun/api with sync:account-api:shared --membership-access-only --update.')
  }

  for (const [name, filename] of Object.entries(copies)) {
    const copy = `cloudfunctions/${name}/lib/${filename}`
    const target = join(root, copy)
    if (existsSync(target) && readFileSync(target).equals(snapshot))
      continue
    if (checkOnly)
      throw new Error(`Membership access copy differs: ${copy}. Run pnpm sync:wxpay-lib.`)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, snapshot)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  syncMembershipAccess({ checkOnly: process.argv.includes('--check') })
