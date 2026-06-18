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

/**
 * 当前线上实际可用的第三方登录方式白名单。
 *
 * 微信网站应用登录（wx_open）需微信开放平台审核 + ICP 备案，未就绪前先从
 * 登录页与账号安全设置中隐藏，避免用户点击后报错伤害信任；待 CloudBase
 * 配置完成后，把 WECHAT_PROVIDER_ID 加进此列表即可一处开启、多处同步显示。
 */
export const ENABLED_OAUTH_PROVIDERS: readonly string[] = [GITHUB_PROVIDER_ID]

export function isOAuthProviderEnabled(providerId: string | null | undefined) {
  return ENABLED_OAUTH_PROVIDERS.includes(normalizeOAuthProviderId(providerId))
}
