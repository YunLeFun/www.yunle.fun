interface SessionProfileIdentity {
  id?: string | null
  login?: string | null
}

interface PublicProfileIdentity {
  userId: string
  login: string | null
}

/**
 * Build a stable public profile URL.
 *
 * Once the public profile has loaded it is authoritative: accounts without a
 * username must use their immutable user id instead of stale auth metadata.
 */
export function getPublicProfilePath(
  user: SessionProfileIdentity | null | undefined,
  profile: PublicProfileIdentity | null | undefined,
): string | null {
  const identifier = profile
    ? profile.login?.trim() || profile.userId
    : user?.login?.trim() || user?.id

  return identifier ? `/u/${encodeURIComponent(identifier)}` : null
}
