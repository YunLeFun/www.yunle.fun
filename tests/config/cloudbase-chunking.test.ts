import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadNuxtConfig } from '@nuxt/kit'
import { build } from 'vite'
import { describe, expect, it } from 'vitest'

const rootDir = fileURLToPath(new URL('../..', import.meta.url))

describe('cloudbase client chunking', () => {
  it('starts authentication when the SDK shares a CommonJS dependency with the app entry', async () => {
    const config = await loadNuxtConfig({ cwd: rootDir })
    const output = config.vite?.build?.rolldownOptions?.output
    const outputOptions = Array.isArray(output) ? output[0] : output
    const fixture = await mkdtemp(join(tmpdir(), 'cloudbase-chunking-'))
    try {
      // Both the entry and SDK require the encoding shim. Splitting only SDK/auth modules
      // can leave the shim's CommonJS factory in the entry, creating a startup cycle:
      // entry -> auth composable -> SDK -> entry's not-yet-initialized factory.
      const files = {
        'package.json': JSON.stringify({ type: 'module' }),
        'entry.ts': [
          'import { sdkValue } from "./app/composables/useCloudbase.ts"',
          'import getEncoding from "text-encoding-shim"',
          'if (sdkValue !== getEncoding()) throw new Error("SDK not initialized")',
          'console.log("CLOUDBASE_STARTED")',
        ].join('\n'),
        'app/composables/useCloudbase.ts': [
          'import sdk from "@cloudbase/fake"',
          'export const sdkValue = sdk.value',
        ].join('\n'),
        'node_modules/@cloudbase/fake/package.json': JSON.stringify({ name: '@cloudbase/fake', main: 'index.cjs' }),
        'node_modules/@cloudbase/fake/index.cjs': [
          'const getEncoding = require("text-encoding-shim")',
          'module.exports = { value: getEncoding() }',
        ].join('\n'),
        'node_modules/text-encoding-shim/package.json': JSON.stringify({ name: 'text-encoding-shim', main: 'index.cjs' }),
        'node_modules/text-encoding-shim/index.cjs': 'module.exports = function getEncoding() { return "utf-8" }',
      }
      await Promise.all(Object.entries(files).map(async ([file, content]) => {
        const target = join(fixture, file)
        await mkdir(dirname(target), { recursive: true })
        await writeFile(target, content)
      }))

      await build({
        configFile: false,
        root: fixture,
        logLevel: 'silent',
        build: {
          minify: false,
          outDir: join(fixture, 'dist'),
          emptyOutDir: true,
          rolldownOptions: {
            input: join(fixture, 'entry.ts'),
            output: { ...outputOptions, format: 'es', entryFileNames: 'entry.mjs', chunkFileNames: '[name]-[hash].mjs' },
          },
        },
      })

      // A fresh Node process runs the actual ESM output, without Vitest's module transform
      // or module cache masking factory initialization order. No browser SDK/network is used.
      const started = spawnSync(process.execPath, [join(fixture, 'dist/entry.mjs')], { encoding: 'utf8', timeout: 10_000 })
      expect(started.status, started.stderr || started.error?.message).toBe(0)
      expect(started.stdout).toContain('CLOUDBASE_STARTED')
    }
    finally {
      await rm(fixture, { recursive: true, force: true })
    }
  }, 30_000)
})
