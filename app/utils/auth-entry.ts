import { getSafeLoginRedirect } from './authRoutes'

/**
 * 登录页的「来路」：用户是从哪里被送到 /login 的，登录完成后又要回到哪里。
 *
 * - direct：直接打开登录页，登录后回首页。
 * - sso：其他云乐坊应用发起的跨站 SSO（/auth/sso?client_id=…），登录后回到该应用。
 * - device：桌面 / 本地应用的设备授权（/link?code=…），登录后去授权页确认。
 * - page：站内受保护页面（钱包、设置等），登录后继续前往。
 *
 * 只做展示用的解析；真正的参数校验与授权仍由 /auth/sso、/link 和云函数负责。
 */
export type AuthEntry
  = | { kind: 'direct', redirect: '/' }
    | { kind: 'page', redirect: string, label: string | null }
    | { kind: 'sso', redirect: string, clientId: string, redirectUri: string, native: boolean }
    | { kind: 'device', redirect: string, userCode: string | null }

const PAGE_LABELS: ReadonlyArray<[prefix: string, label: string]> = [
  ['/wallet', '钱包'],
  ['/settings', '账号设置'],
  ['/profile', '个人中心'],
  ['/feed', '关注动态'],
  ['/pricing', '会员'],
  ['/claim', '领取奖励'],
  ['/developer', '开发者中心'],
  ['/app-edit', '应用编辑'],
  ['/apps', '应用'],
  ['/explore', '应用星图'],
]

const NATIVE_CLIENT_ID_RE = /-(?:ios|android|mobile)$/

function firstQuery(params: URLSearchParams, key: string) {
  return params.get(key)?.trim() ?? ''
}

function labelForPath(path: string) {
  const match = PAGE_LABELS.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`))
  return match?.[1] ?? null
}

export function parseAuthEntry(rawRedirect: unknown): AuthEntry {
  const redirect = getSafeLoginRedirect(rawRedirect)
  if (redirect === '/')
    return { kind: 'direct', redirect: '/' }

  const url = new URL(redirect, 'https://www.yunle.fun')
  const path = url.pathname.replace(/\/+$/, '') || '/'

  if (path === '/auth/sso') {
    const clientId = firstQuery(url.searchParams, 'client_id')
    const redirectUri = firstQuery(url.searchParams, 'redirect_uri')
    if (clientId && redirectUri) {
      return {
        kind: 'sso',
        redirect,
        clientId,
        redirectUri,
        native: Boolean(firstQuery(url.searchParams, 'native_callback_uri')) || NATIVE_CLIENT_ID_RE.test(clientId),
      }
    }
    return { kind: 'page', redirect, label: null }
  }

  if (path === '/link')
    return { kind: 'device', redirect, userCode: firstQuery(url.searchParams, 'code') || null }

  return { kind: 'page', redirect, label: labelForPath(path) }
}

/** 只显示主机名；无法解析时返回空串，由调用方决定兜底文案。 */
export function readableHost(url: string) {
  try {
    return new URL(url).host
  }
  catch {
    return ''
  }
}

/** 在登录 / 注册之间切换时保留来路，避免绕一圈后丢掉 SSO 请求。 */
export function withAuthRedirect(path: '/login' | '/signup', entry: AuthEntry) {
  return entry.kind === 'direct'
    ? { path }
    : { path, query: { redirect: entry.redirect } }
}
