import { fileURLToPath } from 'node:url'
import { loadNuxtConfig } from '@nuxt/kit'
import { afterEach, describe, expect, it, vi } from 'vitest'

const rootDir = fileURLToPath(new URL('../..', import.meta.url))

describe('apps platform API configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('uses the production apps service as its server-only default', async () => {
    vi.stubEnv('NUXT_APPS_PLATFORM_API_URL', '')
    const config = await loadNuxtConfig({ cwd: rootDir })

    expect(config.runtimeConfig?.appsPlatformApiUrl).toBe('https://apps.yunle.fun')
    expect(config.runtimeConfig?.public).not.toHaveProperty('appsPlatformApiUrl')
  })
})
