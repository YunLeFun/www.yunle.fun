export const USERNAME_MIN_LENGTH = 5
export const USERNAME_MAX_LENGTH = 20
export const USERNAME_PATTERN = /^[a-z][\w-]{4,19}$/i
const TEMPORARY_USERNAME_PATTERN = /^tmp_[0-9a-z]{6,16}$/i

export function isValidUsername(username: string) {
  return USERNAME_PATTERN.test(username)
}

export function isTemporaryUsername(username: string | null | undefined) {
  return !!username && TEMPORARY_USERNAME_PATTERN.test(username)
}

export function generateTemporaryUsername(userId: string) {
  const normalizedId = userId.trim()
  if (/^\d+$/.test(normalizedId)) {
    const suffix = BigInt(normalizedId).toString(36).padStart(6, '0')
    return `tmp_${suffix}`.slice(0, USERNAME_MAX_LENGTH)
  }

  let first = 0x811C9DC5
  let second = 0x9E3779B9
  for (let index = 0; index < normalizedId.length; index++) {
    const code = normalizedId.charCodeAt(index)
    first = Math.imul(first ^ code, 0x01000193)
    second = Math.imul(second ^ code, 0x85EBCA6B)
  }
  const suffix = `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`
    .padStart(12, '0')
    .slice(0, 16)
  return `tmp_${suffix}`
}

/**
 * CloudBase 的 GitHub OAuth 默认会把 GitHub 数字用户 ID 写入 username。
 * 该值只是第三方身份标识，不是用户主动选择的云乐坊公开用户名。
 */
export function isOAuthUsernamePlaceholder(
  username: string | null | undefined,
  providerIds: readonly (string | null | undefined)[],
) {
  if (!username)
    return false

  const isGitHubUser = providerIds.some(provider => provider?.toLowerCase() === 'github')
  return isGitHubUser && /^\d+$/.test(username)
}
