import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('public page hydration', () => {
  it('keeps the auth-dependent onboarding modal out of the server-rendered tree', () => {
    const source = readFileSync(new URL('../../app/app.vue', import.meta.url), 'utf8')

    expect(source).toMatch(
      /<ClientOnly>\s*<LazyOnboardingModal\s+v-if="hasUser"\s*\/>\s*<\/ClientOnly>/,
    )
  })
})
