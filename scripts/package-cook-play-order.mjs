#!/usr/bin/env node
/** Prepare isolated CloudBase Event Function packages offline. */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { REFRESH_CRON, TRIGGER_NAME } from '../cloudfunctions/cook-play-order/subscription-refresh.js'
import { syncMembershipAccess } from './sync-membership-access.mjs'

const root = fileURLToPath(new URL('../cloudfunctions', import.meta.url))
const source = join(root, 'cook-play-order')
const output = process.argv[2]
if (!output || process.argv.length !== 3)
  throw new Error('Usage: node scripts/package-cook-play-order.mjs <new-output-directory>')
syncMembershipAccess({ checkOnly: true })
const dest = resolve(output)
await mkdir(dest)
const pkg = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
const handlers = {
  'cook-play-order': 'index.js',
  'cook-play-order-sandbox': 'sandbox.js',
  'cook-play-notify': 'notify.js',
  'cook-play-notify-sandbox': 'notify-sandbox.js',
  'cook-play-refresh': 'refresh.js',
  'cook-play-refresh-sandbox': 'refresh-sandbox.js',
}
for (const [name, entry] of Object.entries(handlers)) {
  const target = join(dest, name)
  await mkdir(join(target, 'lib'), { recursive: true })
  await copyFile(join(source, entry), join(target, 'index.js'))
  await writeFile(join(target, 'package.json'), `${JSON.stringify({ ...pkg, name }, null, 2)}\n`)
  await copyFile(join(root, 'iap-order/account-access.js'), join(target, 'account-access.js'))
  for (const file of ['ownership.js', 'publisher.js', 'purchase-proof.js', 'push.js', 'routing.js', 'runtime.js', 'settlement.js', 'subscription-refresh.js', 'subscriptions.js'])
    await copyFile(join(source, file), join(target, file))
  for (const file of ['iap-sandbox.js', 'iap-settlement.js', 'membership-access.js', 'membership.js', 'orders.js', 'synthetic-order.js', 'wallet.js'])
    await copyFile(join(root, 'wxpay-order/lib', file), join(target, 'lib', file))
}
const refreshFunctions = ['cook-play-refresh', 'cook-play-refresh-sandbox'].map(name => ({
  name,
  type: 'Event',
  handler: 'index.main',
  runtime: 'Nodejs20.19',
  timeout: 60,
  installDependency: true,
  aclRule: { invoke: false },
  triggers: [{ name: TRIGGER_NAME, type: 'timer', config: REFRESH_CRON }],
}))
await writeFile(join(dest, 'cloudbaserc.json'), `${JSON.stringify({ version: '2.0', functionRoot: '.', functions: refreshFunctions }, null, 2)}\n`)
console.log('Prepared the Play purchase, notification, and scheduled refresh packages for both ledgers')
