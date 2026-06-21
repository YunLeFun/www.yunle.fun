<script setup lang="ts">
import type { SsoResultMessage } from '@yunlefun/sso/protocol'
import {
  encodeSsoRedirectResult,
  isAnonymousSession,
  readSsoMode,
  readSsoNonce,
  readSsoReturnUrl,
  readSsoTargetOrigin,
  SSO_REDIRECT_HASH_KEY,
  SSO_RESULT_TYPE,
} from '@yunlefun/sso/protocol'
import { isAllowedSsoTargetOrigin, readSsoTargetRules } from '~/utils/ssoTargetOrigins'

/**
 * Lightweight SSO bridge for YunLeFun sub-apps.
 *
 * This route runs on www.yunle.fun so it can read the main site's CloudBase
 * session from local persistence. It sends the session only to explicitly
 * allowlisted child origins and only when the caller's nonce matches.
 */
definePageMeta({
  layout: 'auth',
})

useSeoMeta({
  title: '账号同步 - 云乐坊',
  robots: 'noindex,nofollow',
})

const LOCAL_TARGET_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:2333',
  'http://127.0.0.1:2333',
  'http://localhost:3333',
  'http://127.0.0.1:3333',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
  'http://localhost:5175',
  'http://127.0.0.1:5175',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
] as const

const route = useRoute()
const router = useRouter()
const { app, auth } = useCloudbase()
const config = useRuntimeConfig()
const allowedTargetRules = [
  ...readSsoTargetRules(config.public.ssoAllowedTargetOrigins),
  ...readSsoTargetRules(LOCAL_TARGET_ORIGINS.join(',')),
]

const status = ref<'checking' | 'success' | 'error'>('checking')
const message = ref('正在同步云乐坊账号...')

function isAllowedTarget(origin: string): boolean {
  return isAllowedSsoTargetOrigin(origin, allowedTargetRules)
}

function postToRequester(targetOrigin: string, payload: SsoResultMessage): void {
  const target = window.opener ?? window.parent
  if (!target || target === window) {
    status.value = 'error'
    message.value = '没有找到请求登录状态的页面。'
    return
  }

  target.postMessage(payload, targetOrigin)
  status.value = payload.ok ? 'success' : 'error'
  message.value = payload.ok ? '账号已同步，窗口即将关闭。' : '账号暂未登录。'

  if (window.opener) {
    setTimeout(() => {
      window.close()
    }, 240)
  }
}

function postInvalidRequest(targetOrigin: string, nonce: string): void {
  if (targetOrigin && isAllowedTarget(targetOrigin) && nonce) {
    postToRequester(targetOrigin, {
      type: SSO_RESULT_TYPE,
      ok: false,
      nonce,
      reason: 'invalid_request',
    })
    return
  }
  // 扩展排查信息：指明具体哪个参数非法（最常见是子站来源未加入白名单），便于接入时定位
  const problems: string[] = []
  if (!targetOrigin)
    problems.push('targetOrigin 缺失或格式非法')
  else if (!isAllowedTarget(targetOrigin))
    problems.push(`来源 ${targetOrigin} 不在 SSO 白名单（请在 NUXT_PUBLIC_SSO_ALLOWED_TARGET_ORIGINS 中添加）`)
  if (!nonce)
    problems.push('nonce 缺失')
  const detail = problems.join('；') || '未知原因'
  status.value = 'error'
  message.value = `SSO 请求参数无效：${detail}`
  console.warn('[sso] 拒绝无效 SSO 请求：', { targetOrigin, nonce, detail })
}

function currentSsoPath(): string {
  return router.currentRoute.value.fullPath
}

/**
 * 最佳努力：为当前登录用户换取一次性自定义登录票据（云函数 sso-ticket）。
 * 子站凭票据 `signInWithCustomTicket` 建立**自己独立、可同源续期的会话**，不再复用主站会话。
 * 任何失败（未配置私钥 / 调用异常 / 未登录）都返回 undefined —— 桥接回退到仅转发 session，向后兼容。
 */
async function mintSsoTicket(): Promise<string | undefined> {
  try {
    const res = await app.callFunction({ name: 'sso-ticket' }) as { result?: { ok?: boolean, ticket?: unknown } }
    const ticket = res?.result?.ok ? res.result.ticket : ''
    return typeof ticket === 'string' && ticket ? ticket : undefined
  }
  catch {
    return undefined
  }
}

/** redirect 模式：把结果写进回跳地址的 fragment 并整页跳回子站（先抹掉 returnUrl 自带的 hash）。 */
function redirectBack(returnUrl: string, value: string): void {
  const url = new URL(returnUrl)
  url.hash = `${SSO_REDIRECT_HASH_KEY}=${value}`
  status.value = 'success'
  message.value = '账号已同步，正在返回…'
  window.location.replace(url.toString())
}

onMounted(async () => {
  const mode = readSsoMode(route.query.mode)
  const targetOrigin = readSsoTargetOrigin(route.query.targetOrigin)
  const nonce = readSsoNonce(route.query.nonce)

  // redirect 模式（顶层重定向，抗存储分区）：回跳地址必须存在且其 origin 在白名单内
  // ——否则就是开放重定向漏洞。非 redirect 模式不需要 returnUrl。
  const returnUrl = mode === 'redirect' ? readSsoReturnUrl(route.query.returnUrl) : ''
  const returnOk = mode !== 'redirect' || (!!returnUrl && isAllowedTarget(new URL(returnUrl).origin))

  if (!targetOrigin || !nonce || !isAllowedTarget(targetOrigin) || !returnOk) {
    postInvalidRequest(targetOrigin, nonce)
    return
  }

  try {
    const { data } = await auth.getSession()
    const session = data?.session
    if (session && !isAnonymousSession(session)) {
      // Hand the sub-app a one-time custom-login ticket so it can establish its *own*
      // independent, same-origin-renewable session instead of reusing (and racing)
      // the main site's single-use refresh_token.
      const ticket = await mintSsoTicket()

      if (mode === 'redirect') {
        // The redirect channel only ever carries the one-time ticket — never the
        // refresh_token (putting it in a URL is the deprecated implicit-flow
        // anti-pattern). No ticket (custom-login unconfigured) → signal
        // `not_configured` so the sub-app falls back to popup/iframe.
        redirectBack(returnUrl, encodeSsoRedirectResult(
          ticket ? { nonce, ok: true, ticket } : { nonce, ok: false, reason: 'not_configured' },
        ))
        return
      }

      // iframe / popup channel: deliver the session (+ ticket when available) via
      // postMessage. `ticket` is an additive SsoResultMessage field; the intersection
      // keeps this typechecking against both the current and ticket-aware package.
      const payload = { type: SSO_RESULT_TYPE, ok: true, nonce, session } as SsoResultMessage & { ticket?: string }
      if (ticket)
        payload.ticket = ticket
      postToRequester(targetOrigin, payload)
      return
    }

    // Not logged in: interactive *and* redirect both route through /login, then come
    // back to this bridge (same query) to finish once a session exists.
    if (mode === 'interactive' || mode === 'redirect') {
      await navigateTo({
        path: '/login',
        query: { redirect: currentSsoPath() },
      })
      return
    }

    postToRequester(targetOrigin, {
      type: SSO_RESULT_TYPE,
      ok: false,
      nonce,
      reason: 'not_authenticated',
    })
  }
  catch (err) {
    console.error('[sso] session bridge failed:', err)
    if (mode === 'redirect' && returnUrl) {
      redirectBack(returnUrl, encodeSsoRedirectResult({ nonce, ok: false, reason: 'error' }))
      return
    }
    postToRequester(targetOrigin, {
      type: SSO_RESULT_TYPE,
      ok: false,
      nonce,
      reason: 'not_authenticated',
    })
  }
})
</script>

<template>
  <div class="text-center space-y-6">
    <div class="flex justify-center">
      <UIcon
        v-if="status === 'checking'"
        name="i-lucide-loader-circle"
        class="h-14 w-14 animate-spin text-primary"
      />
      <UIcon
        v-else-if="status === 'success'"
        name="i-lucide-check-circle"
        class="h-14 w-14 text-green-500"
      />
      <UIcon
        v-else
        name="i-lucide-x-circle"
        class="h-14 w-14 text-red-500"
      />
    </div>

    <div class="space-y-2">
      <h1 class="text-2xl font-bold">
        账号同步
      </h1>
      <p class="text-muted">
        {{ message }}
      </p>
    </div>
  </div>
</template>
