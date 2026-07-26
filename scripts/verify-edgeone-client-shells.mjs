import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadNuxtConfig } from '@nuxt/kit'

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)))
const config = await loadNuxtConfig({ cwd: rootDir })
const routeRules = config.routeRules ?? {}
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

const failures = []

for (const route of clientShellRoutes) {
  const outputPath = join(rootDir, '.output/public', route.slice(1), 'index.html')

  try {
    const html = await readFile(outputPath, 'utf8')
    const scriptTags = html.match(/<script[^>]*>/gi) ?? []
    const hasClientEntry = scriptTags.some(tag =>
      /type=["']module["']/i.test(tag)
      && /src=["']\/_nuxt\//i.test(tag),
    )
    if (!hasClientEntry)
      failures.push(`${route}: missing /_nuxt/ module entry in ${outputPath}`)
  }
  catch (error) {
    failures.push(`${route}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

if (failures.length > 0)
  throw new Error(`Invalid EdgeOne client shells:\n${failures.join('\n')}`)

console.log(`Verified ${clientShellRoutes.length} EdgeOne client shells with module entry scripts`)
