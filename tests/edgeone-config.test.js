import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const config = JSON.parse(readFileSync(new URL('../edgeone.json', import.meta.url), 'utf8'))

describe('edgeOne production configuration', () => {
  it('uses the Nuxt full-stack build in bounded regions', () => {
    expect(config.buildCommand).toBe('pnpm build')
    expect(config.nodeVersion).toBe('20.18.0')
    expect(config.cloudFunctions).toEqual({
      mainlandRegions: ['ap-shanghai'],
      overseasRegions: ['ap-singapore'],
      nodejs: { maxDuration: 30 },
    })
  })

  it('sets baseline transport and browser isolation headers', () => {
    const headers = Object.fromEntries(config.headers[0].headers.map(header => [header.key, header.value]))
    expect(headers['Strict-Transport-Security']).toBe('max-age=31536000')
    expect(headers['X-Content-Type-Options']).toBe('nosniff')
    expect(headers['X-Frame-Options']).toBe('DENY')
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
    expect(headers['Permissions-Policy']).toBe('camera=(), microphone=(), geolocation=()')
  })
})
