import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('server import boundaries', () => {
  it('uses the Nuxt root alias for reward security shared with cloud functions', async () => {
    const source = await readFile(
      new URL('../../server/api/reward-claims/rate-ticket.post.ts', import.meta.url),
      'utf8',
    )

    expect(source).toContain(
      'from \'~~/cloudfunctions/account-api/reward-claim-security.js\'',
    )
    expect(source).not.toMatch(
      /from ['"](?:\.\.\/)+cloudfunctions\/account-api\/reward-claim-security\.js['"]/,
    )
  })
})
