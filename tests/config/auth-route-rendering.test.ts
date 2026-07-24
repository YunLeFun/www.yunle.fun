import { fileURLToPath } from 'node:url'
import { loadNuxtConfig } from '@nuxt/kit'
import { describe, expect, it } from 'vitest'

const rootDir = fileURLToPath(new URL('../..', import.meta.url))

describe('authentication route rendering', () => {
  it('prerenders authentication entry points with client modules for EdgeOne', async () => {
    const config = await loadNuxtConfig({ cwd: rootDir })
    const routeRules = config.routeRules ?? {}
    const expectedRoutes = ['/login', '/signup', '/link', '/auth/sso', '/auth/github', '/auth/callback']

    for (const route of expectedRoutes)
      expect(routeRules[route]).toMatchObject({ prerender: true, ssr: false })

    expect(routeRules['/auth/**']).toMatchObject({ ssr: false })
    expect(routeRules['/auth/sso']).toMatchObject({
      prerender: true,
      ssr: false,
      headers: {
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
      },
    })
    expect(config.nitro?.prerender?.routes).toEqual(expect.arrayContaining(expectedRoutes))
  })
})
