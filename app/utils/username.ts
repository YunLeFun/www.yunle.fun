export const USERNAME_MIN_LENGTH = 6
export const USERNAME_MAX_LENGTH = 20
export const USERNAME_PATTERN = /^[a-z][0-9a-z_-]{5,19}$/
export const USERNAME_RULE_DESCRIPTION = '用户名需为 6-20 个字符，以小写字母开头，只允许小写字母、数字、下划线和连字符'
const AUTH_USERNAME_COMPATIBILITY_PATTERN = /^[a-z][\w-]{2,24}$/i
const TEMPORARY_USERNAME_PATTERN = /^tmp_[0-9a-z]{6,16}$/i

export function normalizeUsername(username: string) {
  return username.trim().toLowerCase()
}

export function isValidUsername(username: string) {
  return USERNAME_PATTERN.test(username)
}

/** 只用于登录和 Auth 资料快照，兼容新规范生效前已经存在的账号。 */
export function isAuthUsernameCompatible(username: string) {
  return AUTH_USERNAME_COMPATIBILITY_PATTERN.test(username)
}

export function getUsernameValidationError(username: string) {
  if (!username)
    return '请输入用户名'
  if (username.length < USERNAME_MIN_LENGTH)
    return `用户名至少 ${USERNAME_MIN_LENGTH} 个字符`
  if (username.length > USERNAME_MAX_LENGTH)
    return `用户名不能超过 ${USERNAME_MAX_LENGTH} 个字符`
  if (!/^[a-z]/.test(username))
    return '用户名必须以字母开头'
  if (!USERNAME_PATTERN.test(username))
    return '只允许小写字母、数字、下划线和连字符'
  if (isTemporaryUsername(username))
    return '该用户名使用了系统保留格式，请换一个试试'
  return ''
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error)
    return error.message
  if (error && typeof error === 'object') {
    const source = error as Record<string, unknown>
    return String(source.message || source.error_description || source.error || '')
  }
  return String(error || '')
}

/** 把 CloudBase 原始错误收敛为可直接显示在用户名字段下方的消息。 */
export function getUsernameUpdateErrorMessage(error: unknown) {
  const message = getErrorMessage(error)
  if (/^用户名(?:至少|不能超过|必须以)|^只允许小写字母、数字、下划线和连字符$/.test(message))
    return message
  if (/duplicate|already.*exist|already.*used|exist.*already|已被?占用|已存在/i.test(message))
    return '该用户名已被占用，请换一个试试'
  if (/conflict|concurrent|version|状态已变化|并发/i.test(message))
    return '用户名状态已变化，请刷新后重试'
  if (/保留格式/.test(message))
    return '该用户名使用了系统保留格式，请换一个试试'
  if (/必须匹配|pattern|格式不正确|format|5\s*[-–]\s*20|6\s*[-–]\s*2[05]/i.test(message))
    return USERNAME_RULE_DESCRIPTION
  if (/用户名已设置|不可修改/.test(message))
    return '用户名已设置，不可修改'
  return '用户名设置失败，请稍后重试'
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
 * 纯数字不符合公开用户名规则，因此即使身份源元数据暂时缺失，也可以安全地
 * 将其视为第三方身份占位值。
 */
export function isOAuthUsernamePlaceholder(username: string | null | undefined) {
  return !!username && /^\d+$/.test(username)
}
