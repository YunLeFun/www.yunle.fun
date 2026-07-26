import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const caddyConfig = resolve(repositoryRoot, 'dev/Caddyfile')
const providerOrigin = 'https://www.yunle.localhost:3000'
const developmentCloudbaseEnvId = 'yunlefun-dev-0ge03bdod37093d1'
const children = []
let stopping = false

function probePort(port) {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer()
    server.once('error', rejectPort)
    server.listen(port, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        rejectPort(new Error('Unable to select a Nuxt loopback port'))
        return
      }
      server.close(error => error ? rejectPort(error) : resolvePort(address.port))
    })
  })
}

async function selectUpstreamPort() {
  try {
    return await probePort(3001)
  }
  catch (error) {
    if (error?.code !== 'EADDRINUSE')
      throw error
    return probePort(0)
  }
}

async function assertCommand(command, installHint) {
  await new Promise((resolveCheck, rejectCheck) => {
    const check = spawn(command, ['version'], { stdio: 'ignore' })
    check.once('error', () => rejectCheck(new Error(`${command} is required. ${installHint}`)))
    check.once('exit', code => code === 0
      ? resolveCheck()
      : rejectCheck(new Error(`${command} version check failed with exit code ${code}`)))
  })
}

function start(label, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit',
    ...options,
  })
  children.push({ child, label })
  return child
}

function stopChildren(signal = 'SIGTERM') {
  if (stopping)
    return
  stopping = true
  for (const { child } of children) {
    if (child.exitCode === null && child.signalCode === null)
      child.kill(signal)
  }
}

function waitForExit(child, label) {
  return new Promise((resolveExit) => {
    child.once('error', error => resolveExit({ label, code: 1, error }))
    child.once('exit', (code, signal) => resolveExit({ label, code, signal }))
  })
}

await access(caddyConfig)
await assertCommand('caddy', 'Install Caddy and ensure the caddy executable is available on PATH.')
const upstreamPort = await selectUpstreamPort()
const upstream = `127.0.0.1:${upstreamPort}`

console.log(`SSO Provider development origin: ${providerOrigin}`)
console.log(`CloudBase tenant: ${developmentCloudbaseEnvId}`)
console.log(`Nuxt upstream: http://${upstream}`)

const gateway = start('Caddy HTTPS gateway', 'caddy', [
  'run',
  '--config',
  caddyConfig,
  '--adapter',
  'caddyfile',
], {
  env: {
    ...process.env,
    YUNLE_PROVIDER_UPSTREAM: upstream,
  },
})
const provider = start('Nuxt SSO Provider', 'pnpm', [
  'exec',
  'nuxt',
  'dev',
  '--host',
  '127.0.0.1',
  '--port',
  String(upstreamPort),
], {
  env: {
    ...process.env,
    NUXT_PUBLIC_SITE_URL: providerOrigin,
    NUXT_PUBLIC_API_BASE_URL: providerOrigin,
    NUXT_PUBLIC_CLOUDBASE_ENV_ID: process.env.NUXT_PUBLIC_CLOUDBASE_ENV_ID ?? developmentCloudbaseEnvId,
  },
})
const gatewayExit = waitForExit(gateway, 'Caddy HTTPS gateway')
const providerExit = waitForExit(provider, 'Nuxt SSO Provider')

for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => stopChildren(signal))

const firstExit = await Promise.race([
  gatewayExit,
  providerExit,
])

if (!stopping) {
  const detail = firstExit.error?.message
    ?? (firstExit.signal ? `signal ${firstExit.signal}` : `exit code ${firstExit.code}`)
  console.error(`${firstExit.label} stopped unexpectedly (${detail})`)
  process.exitCode = firstExit.code || 1
  stopChildren()
}

const forceStop = setTimeout(() => {
  for (const { child } of children) {
    if (child.exitCode === null && child.signalCode === null)
      child.kill('SIGKILL')
  }
}, 5_000)

await Promise.all([gatewayExit, providerExit])
clearTimeout(forceStop)
