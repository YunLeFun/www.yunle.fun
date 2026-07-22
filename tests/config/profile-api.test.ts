import { fileURLToPath } from 'node:url'
import { loadNuxtConfig } from '@nuxt/kit'
import { afterEach, describe, expect, it, vi } from 'vitest'

const rootDir = fileURLToPath(new URL('../..', import.meta.url))

describe('public profile API configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('has a safe production default when EdgeOne omits the optional override', async () => {
    vi.stubEnv('NUXT_ACCOUNT_API_HTTP_URL', '')
    const config = await loadNuxtConfig({ cwd: rootDir })

    expect(config.runtimeConfig?.accountApiHttpUrl).toBe('https://api.yunle.fun/account-api')
  })
})
