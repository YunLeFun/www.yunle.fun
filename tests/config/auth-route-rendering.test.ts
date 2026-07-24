import { fileURLToPath } from 'node:url'
import { loadNuxtConfig } from '@nuxt/kit'
import { describe, expect, it } from 'vitest'

const rootDir = fileURLToPath(new URL('../..', import.meta.url))

describe('authentication route rendering', () => {
  it('keeps authentication entry points SSR-enabled for EdgeOne', async () => {
    const config = await loadNuxtConfig({ cwd: rootDir })
    const routeRules = config.routeRules ?? {}

    expect(routeRules['/login']).toMatchObject({ ssr: true })
    expect(routeRules['/signup']).toMatchObject({ ssr: true })
    expect(routeRules['/link']).toMatchObject({ ssr: true })
    expect(routeRules['/auth/**']).toMatchObject({ ssr: true })
    expect(routeRules['/auth/sso']).toMatchObject({
      headers: {
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
      },
    })
  })
})
