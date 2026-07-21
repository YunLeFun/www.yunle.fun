import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { homePage } from '../../app/config/home'

describe('download route', () => {
  it('uses /download as the canonical route and redirects the legacy path', () => {
    const root = new URL('../../', import.meta.url)
    const nuxtConfig = readFileSync(new URL('nuxt.config.ts', root), 'utf8')

    expect(homePage.hero.links[1]?.to).toBe('/download')
    expect(existsSync(new URL('app/pages/download.vue', root))).toBe(true)
    expect(existsSync(new URL('app/pages/apps/download.vue', root))).toBe(false)
    expect(nuxtConfig).toMatch(/'\/apps\/download': \{ redirect: \{ to: '\/download', statusCode: 301 \} \}/)
  })
})
