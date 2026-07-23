import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('profile edit entry', () => {
  it('opens the profile settings form in edit mode', async () => {
    const source = await readFile(new URL('../../app/pages/profile.vue', import.meta.url), 'utf8')

    expect(source).toContain('to="/settings?edit=profile"')
  })
})
