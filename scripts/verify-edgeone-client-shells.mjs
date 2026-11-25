import { access, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadNuxtConfig } from '@nuxt/kit'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const config = await loadNuxtConfig({ cwd: rootDir })
const routeRules = config.routeRules ?? {}
const outputRoots = [
  join(rootDir, '.output/public'),
  join(rootDir, '.edgeone/assets'),
  join(rootDir, 'dist'),
]
const clientShellRoutes = Object.entries(routeRules)
  .filter(([route, rule]) =>
    !route.includes('*')
    && rule?.prerender === true
    && rule?.ssr === false,
  )
  .map(([route]) => route)
  .sort()

if (clientShellRoutes.length === 0)
  throw new Error('No prerendered client-only routes were found in Nuxt routeRules')

const verifiedRoutes = ['/login', ...clientShellRoutes]
let selectedOutputRoot = ''

for (const outputRoot of outputRoots) {
  try {
    await access(join(outputRoot, 'login/index.html'))
    selectedOutputRoot = outputRoot
    break
  }
  catch {}
}

if (!selectedOutputRoot)
  throw new Error(`No client shell output found in ${outputRoots.join(' or ')}`)

const failures = []

for (const route of verifiedRoutes) {
  const outputPath = join(selectedOutputRoot, route.slice(1), 'index.html')

  try {
    const html = await readFile(outputPath, 'utf8')
    const scriptTags = html.match(/<script[^>]*>/gi) ?? []
    const hasClientEntry = scriptTags.some(tag =>
      /type=["']module["']/i.test(tag)
      && /src=["']\/_nuxt\//i.test(tag),
    )
    if (!hasClientEntry)
      failures.push(`${route}: missing /_nuxt/ module entry in ${outputPath}`)
    if (route === '/login' && !/<input\b[^>]*\sname=["']username["']/i.test(html))
      failures.push(`${route}: missing prerendered login form in ${outputPath}`)
  }
  catch (error) {
    failures.push(`${route}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

if (failures.length > 0)
  throw new Error(`Invalid EdgeOne client shells:\n${failures.join('\n')}`)

console.log(`Verified the prerendered /login form and ${clientShellRoutes.length} EdgeOne client shells with module entry scripts`)
