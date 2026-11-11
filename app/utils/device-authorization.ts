const MESSAGES: Record<string, string> = {
  device_code_expired: '授权码已过期，请回到小云或原应用重新发起授权，再打开新的链接。',
  device_code_not_pending: '此授权请求已处理，请回到原应用查看结果或重新发起授权。',
  device_code_used: '此授权码已使用，请回到原应用查看结果或重新发起授权。',
  login_required: '登录状态已失效，请重新登录后继续授权。',
}

export class DeviceAuthorizationError extends Error {
  constructor(readonly code: string) {
    super(MESSAGES[code] || '授权请求暂不可用，请重新发起或稍后再试。')
    this.name = 'DeviceAuthorizationError'
  }
}

/** Unwrap opted-in business errors without displaying platform or internal data. */
export function deviceAuthorizationResult<T>(result: unknown): T {
  if (result && typeof result === 'object' && 'ok' in result && result.ok === false
    && 'error' in result && result.error && typeof result.error === 'object'
    && 'code' in result.error && typeof result.error.code === 'string') {
    throw new DeviceAuthorizationError(result.error.code)
  }
  return result as T
}
