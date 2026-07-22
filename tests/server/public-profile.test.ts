import type { UserProfile } from '../../app/types/social'
import { describe, expect, it, vi } from 'vitest'
import { resolvePublicProfile } from '../../server/utils/public-profile'

const profile: UserProfile = {
  userId: '2078850644063563776',
  login: null,
  nickname: 'raincither',
  avatar: null,
  description: '',
  followersCount: 0,
  followingCount: 1,
  hideFollowers: false,
  hideFollowing: false,
  notifyOnFollow: true,
  isMember: false,
}

describe('resolvePublicProfile', () => {
  it('resolves a numeric route identifier as a user id', async () => {
    const fetchProfile = vi.fn().mockResolvedValue(profile)

    await expect(resolvePublicProfile({ identifier: profile.userId }, fetchProfile)).resolves.toEqual(profile)
    expect(fetchProfile).toHaveBeenCalledOnce()
    expect(fetchProfile).toHaveBeenCalledWith({ userId: profile.userId })
  })
})
