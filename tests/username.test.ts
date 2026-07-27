import { describe, expect, it } from 'vitest'
import {
  generateTemporaryUsername,
  isOAuthUsernamePlaceholder,
  isTemporaryUsername,
  isValidUsername,
} from '../app/utils/username'

describe('username utilities', () => {
  it('generates a stable valid temporary username from a numeric uid', () => {
    const username = generateTemporaryUsername('2081712496858640384')

    expect(username).toBe('tmp_ftddhqtxqnsw')
    expect(isValidUsername(username)).toBe(true)
    expect(isTemporaryUsername(username)).toBe(true)
  })

  it('generates the same bounded temporary username for a non-numeric uid', () => {
    const first = generateTemporaryUsername('oauth:user@example.com')
    const second = generateTemporaryUsername('oauth:user@example.com')

    expect(first).toBe(second)
    expect(first.length).toBeLessThanOrEqual(20)
    expect(isValidUsername(first)).toBe(true)
    expect(isTemporaryUsername(first)).toBe(true)
  })

  it('does not classify a normal username as temporary', () => {
    expect(isTemporaryUsername('new_github_user')).toBe(false)
  })

  it('only treats numeric OAuth usernames as placeholders', () => {
    expect(isOAuthUsernamePlaceholder('1978032370372050944', ['github'])).toBe(true)
    expect(isOAuthUsernamePlaceholder('rain', ['github'])).toBe(false)
    expect(isOAuthUsernamePlaceholder('legacy.github-user', ['github'])).toBe(false)
    expect(isOAuthUsernamePlaceholder('1978032370372050944', ['email'])).toBe(false)
  })
})
