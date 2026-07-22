import type { UserProfile } from '~/types/social'

export interface ProfileQuery {
  login?: string
  userId?: string
}

export type ProfileFetcher = (query: ProfileQuery) => Promise<UserProfile | null>

export type PublicProfileLookup = { identifier: string } | { login: string } | { userId: string }

const LOGIN_PATTERN = /^[a-z][\w-]{2,19}$/i

/**
 * Resolve the public `/u/:identifier` contract without depending on browser auth.
 * Explicit login/userId lookups stay exact; route identifiers prefer a valid login
 * and otherwise fall back to the immutable CloudBase user id.
 */
export async function resolvePublicProfile(
  lookup: PublicProfileLookup,
  fetchProfile: ProfileFetcher,
): Promise<UserProfile | null> {
  if ('login' in lookup)
    return fetchProfile({ login: lookup.login })
  if ('userId' in lookup)
    return fetchProfile({ userId: lookup.userId })

  const identifier = lookup.identifier
  if (!LOGIN_PATTERN.test(identifier))
    return fetchProfile({ userId: identifier })

  return (await fetchProfile({ login: identifier }))
    ?? fetchProfile({ userId: identifier })
}
