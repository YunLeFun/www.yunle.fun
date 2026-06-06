export const GITHUB_PROVIDER_ID = 'github'
export const WECHAT_PROVIDER_ID = 'wx_open'

const PROVIDER_ALIASES: Record<string, string> = {
  wechat: WECHAT_PROVIDER_ID,
}

export interface OAuthIdentityLike {
  id?: string | null
  provider?: string | null
  bind?: boolean | null
}

export function normalizeOAuthProviderId(providerId: string | null | undefined) {
  if (!providerId)
    return ''
  return PROVIDER_ALIASES[providerId] || providerId
}

export function getBoundOAuthProviderIds(identities: readonly OAuthIdentityLike[]) {
  const providers = new Set<string>()

  for (const identity of identities) {
    if (identity.bind === false)
      continue

    const providerId = normalizeOAuthProviderId(identity.id || identity.provider)
    if (providerId)
      providers.add(providerId)
  }

  return [...providers]
}

export function hasOAuthProvider(providerIds: readonly (string | null | undefined)[], providerId: string) {
  const targetProviderId = normalizeOAuthProviderId(providerId)
  return providerIds.some(id => normalizeOAuthProviderId(id) === targetProviderId)
}
