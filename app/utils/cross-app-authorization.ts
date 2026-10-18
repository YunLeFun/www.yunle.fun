/**
 * `/auth/app` 只服务登记过的原生 App：装了云乐坊 App 时由它认领为 Universal Link，
 * 没装时在系统网页授权里打开同一个地址，再交给 `/auth/sso` 的页面逻辑。
 * 网页客户端继续使用 `/auth/sso`，不会被拉进 App。
 */

/** v1 允许名单：client ID → 唯一的 HTTPS 回调。P2 改为注册表的 `native-app` adapter。 */
export const CROSS_APP_NATIVE_CLIENTS: Readonly<Record<string, string>> = {
  'life-ios': 'https://life.yunle.fun/auth/callback',
}

const REQUIRED_KEYS = ['client_id', 'redirect_uri', 'scope', 'nonce', 'code_challenge', 'code_challenge_method'] as const
const OPTIONAL_KEYS = ['prompt'] as const
const MAX_URL_LENGTH = 4096

/**
 * 校验 `/auth/app` 的完整地址：每个参数恰好出现一次，不允许额外参数、fragment、
 * userinfo 或端口，`redirect_uri` 必须与允许名单中的原生客户端一致。
 * 具体取值（nonce、PKCE、scope）仍由 `/auth/sso` 的协议校验负责。
 */
export function isCrossAppAuthorizationUrl(input: string): boolean {
  if (input.length > MAX_URL_LENGTH)
    return false
  let url: URL
  try {
    url = new URL(input)
  }
  catch {
    return false
  }
  if (url.protocol !== 'https:' || url.hostname !== 'www.yunle.fun' || url.port
    || url.username || url.password || url.hash || url.pathname !== '/auth/app') {
    return false
  }
  const keys = [...url.searchParams.keys()]
  const allowed = new Set<string>([...REQUIRED_KEYS, ...OPTIONAL_KEYS])
  if (keys.length !== new Set(keys).size || keys.some(key => !allowed.has(key)))
    return false
  if (REQUIRED_KEYS.some(key => !url.searchParams.get(key)))
    return false
  const prompt = url.searchParams.get('prompt')
  if (prompt !== null && prompt !== 'select_account' && prompt !== 'consent')
    return false
  const clientId = url.searchParams.get('client_id')!
  return Object.hasOwn(CROSS_APP_NATIVE_CLIENTS, clientId)
    && CROSS_APP_NATIVE_CLIENTS[clientId] === url.searchParams.get('redirect_uri')
}
