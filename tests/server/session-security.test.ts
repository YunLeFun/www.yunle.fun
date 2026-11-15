import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { disableSessionResponseCaching } from '../../server/utils/session-security'

describe('disableSessionResponseCaching', () => {
  it('prevents session responses from entering browser or CDN caches', () => {
    const setHeader = vi.fn()
    const event = {
      node: {
        res: { setHeader },
      },
    }

    disableSessionResponseCaching(event as never)

    expect(setHeader).toHaveBeenCalledWith('cache-control', 'private, no-store')
    expect(setHeader).toHaveBeenCalledWith('pragma', 'no-cache')
  })

  it('configures runtimeConfig.appSecret with NUXT_APP_SECRET and legacy NUXT_SESSION_PASSWORD fallback', () => {
    const nuxtConfig = readFileSync(new URL('../../nuxt.config.ts', import.meta.url), 'utf8')
    expect(nuxtConfig).toMatch(/appSecret:\s*process\.env\.NUXT_APP_SECRET\s*\|\|\s*process\.env\.NUXT_SESSION_PASSWORD\s*\|\|\s*''/)
  })
})
