import { fileURLToPath } from 'node:url'
import { loadNuxtConfig } from '@nuxt/kit'
import { describe, expect, it } from 'vitest'

const rootDir = fileURLToPath(new URL('../..', import.meta.url))

describe('cloudbase client chunking', () => {
  it('keeps the browser SDK out of public-page shared chunks', async () => {
    const config = await loadNuxtConfig({ cwd: rootDir })
    const output = config.vite?.build?.rolldownOptions?.output
    const outputOptions = Array.isArray(output) ? output[0] : output
    const codeSplitting = typeof outputOptions?.codeSplitting === 'object'
      ? outputOptions.codeSplitting
      : undefined
    const groups = codeSplitting?.groups ?? []
    const sdkGroup = groups.find(group => group.name === 'cloudbase-sdk')
    const clientGroup = groups.find(group => group.name === 'cloudbase-client')

    expect(sdkGroup?.includeDependenciesRecursively).toBe(false)
    expect(clientGroup?.includeDependenciesRecursively).toBe(false)

    expect(sdkGroup?.test).toBeInstanceOf(RegExp)
    expect(clientGroup?.test).toBeInstanceOf(RegExp)
    if (!(sdkGroup?.test instanceof RegExp) || !(clientGroup?.test instanceof RegExp))
      return

    expect(sdkGroup.test.test('/repo/node_modules/.pnpm/@cloudbase+js-sdk@3.6.4/index.js')).toBe(true)
    expect(clientGroup.test.test('/repo/app/composables/auth/useAuthCore.ts')).toBe(true)
    expect(clientGroup.test.test('/repo/app/composables/useCloudbase.ts')).toBe(true)
    expect(clientGroup.test.test('/repo/app/composables/useAccountAccess.ts')).toBe(true)
    expect(clientGroup.test.test('/repo/app/composables/useUserProfile.ts')).toBe(true)
    expect(clientGroup.test.test('/repo/app/composables/useAppToast.ts')).toBe(false)
  })

  it('does not emit speculative prefetch hints for authentication chunks', async () => {
    const config = await loadNuxtConfig({ cwd: rootDir })
    const transformManifest = config.hooks?.['build:manifest']
    const manifest = {
      sdk: { file: 'sdk.js', name: 'cloudbase-sdk', prefetch: true },
      client: { file: 'client.js', name: 'cloudbase-client', prefetch: true },
      public: { file: 'public.js', name: 'public-page', prefetch: true },
    }

    expect(transformManifest).toBeTypeOf('function')
    await transformManifest?.(manifest)

    expect(manifest.sdk.prefetch).toBe(false)
    expect(manifest.client.prefetch).toBe(false)
    expect(manifest.public.prefetch).toBe(true)
  })
})
