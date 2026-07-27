import type { TcbRawUser } from '../app/composables/auth/types'
import { describe, expect, it } from 'vitest'
import { mapCloudbaseUser } from '../app/composables/auth/types'

function rawUser(overrides: {
  username: string | null
  provider?: string | null
  providers?: string[]
  nickname?: string | null
  name?: string | null
}): TcbRawUser {
  return {
    id: 'oauth-user',
    aud: '',
    role: ['USER'],
    email: null,
    phone: null,
    app_metadata: {
      provider: overrides.provider ?? null,
      providers: overrides.providers ?? [],
    },
    user_metadata: {
      name: overrides.name ?? null,
      picture: null,
      username: overrides.username,
      nickName: overrides.nickname ?? null,
      avatarUrl: null,
      hasPassword: null,
    },
    identities: null,
    created_at: '',
    updated_at: '',
  }
}

describe('cloudBase OAuth user mapping', () => {
  it.each(['63827846', '18013127'])(
    'treats the GitHub numeric identifier %s as an unset public username',
    (username) => {
      const user = mapCloudbaseUser(rawUser({
        username,
        provider: 'github',
        providers: ['github'],
        nickname: 'GitHub 用户',
      }))

      expect(user).toMatchObject({
        login: null,
        nickname: 'GitHub 用户',
      })
    },
  )

  it('keeps a valid GitHub username as the chosen public username', () => {
    const user = mapCloudbaseUser(rawUser({
      username: 'xrr2016',
      provider: 'github',
      providers: ['github'],
    }))

    expect(user?.login).toBe('xrr2016')
  })

  it('treats a numeric placeholder as unset even when provider metadata is incomplete', () => {
    const user = mapCloudbaseUser(rawUser({
      username: '63827846',
      provider: 'phone',
      providers: ['phone'],
    }))

    expect(user?.login).toBeNull()
  })
})
