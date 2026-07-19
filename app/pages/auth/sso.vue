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
import { createSsoTargetRules, isAllowedSsoTargetOrigin } from '~/utils/ssoTargetOrigins'

/**
 * Lightweight SSO bridge for YunLeFun sub-apps.
 *
 * This route runs on www.yunle.fun so it can prove the main site's current user.
 * It sends only an origin/nonce-bound one-time authorization code to explicitly
 * allowlisted first-party consumers; the main-site session never crosses origins.
 */
definePageMeta({
  layout: 'auth',
})

useSeoMeta({
  title: '账号同步 - 云乐坊',
  robots: 'noindex,nofollow',
})

const route = useRoute()
const router = useRouter()
const { app, auth } = useCloudbase()
const config = useRuntimeConfig()

function isEnabled(value: unknown): boolean {
  return value === true || value === 'true'
}

const allowedTargetRules = createSsoTargetRules(config.public.ssoAllowedTargetOrigins, {
  allowLocal: isEnabled(config.public.ssoAllowLocalTargetOrigins),
})
const allowLocalTargets = isEnabled(config.public.ssoAllowLocalTargetOrigins)
const allowLegacyRedirect = isEnabled(config.public.ssoAllowLegacyRedirect)

const status = shallowRef<'checking' | 'success' | 'error'>('checking')
const message = shallowRef('正在同步云乐坊账号...')

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
 * 为当前登录用户签发一次性授权码。uid 只由云函数调用上下文派生；请求体不含 uid。
 * 子站以同一 origin + nonce 原子兑换，CloudBase ticket 不进入跨站 URL/postMessage。
 */
async function issueSsoCode(input: {
  mode: 'silent' | 'interactive' | 'redirect'
  targetOrigin: string
  returnUrl?: string
  nonce: string
  codeChallenge: string
  codeChallengeMethod: 'S256'
}): Promise<string> {
  const res = await app.callFunction({
    name: 'sso-ticket',
    data: { action: 'issueSsoCode', ...input },
  }) as { result?: { ok?: boolean, code?: unknown, reason?: unknown } }
  const code = res?.result?.ok ? res.result.code : ''
  if (typeof code !== 'string' || !/^[\w-]{43}$/.test(code))
    throw new Error(typeof res?.result?.reason === 'string' ? res.result.reason : 'code_issue_failed')
  return code
}

/**
 * Time-bounded v1 redirect compatibility. The function-side flag must also be enabled.
 * This returns only a one-time custom ticket and never returns the main-site session.
 */
async function mintLegacyRedirectTicket(): Promise<string> {
  const res = await app.callFunction({ name: 'sso-ticket' }) as { result?: { ok?: boolean, ticket?: unknown, reason?: unknown } }
  const ticket = res?.result?.ok ? res.result.ticket : ''
  if (typeof ticket !== 'string' || !ticket)
    throw new Error(typeof res?.result?.reason === 'string' ? res.result.reason : 'legacy_ticket_failed')
  return ticket
}

/** redirect 模式：把结果写进回跳地址的 fragment 并整页跳回子站（先抹掉 returnUrl 自带的 hash）。 */
function redirectBack(returnUrl: string, value: string): void {
  const url = new URL(returnUrl)
  url.hash = `${SSO_REDIRECT_HASH_KEY}=${value}`
  status.value = 'success'
  message.value = '账号已同步，正在返回…'
  window.location.replace(url.toString())
}

function encodeLegacyRedirectTicket(nonce: string, ticket: string): string {
  if (!/^[\w-]{32,128}$/.test(nonce) || !ticket || ticket.length > 8192 || /\p{Cc}/u.test(ticket))
    throw new Error('legacy redirect result is invalid')
  const bytes = new TextEncoder().encode(JSON.stringify({ nonce, ok: true, ticket }))
  let binary = ''
  for (const byte of bytes)
    binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

onMounted(async () => {
  const mode = readSsoMode(route.query.mode)
  // Compatibility cast keeps this repository buildable during the coordinated @yunlefun/sso rollout.
  const targetOrigin = (readSsoTargetOrigin as (raw: unknown, options?: { allowHttpLocalhost?: boolean }) => string)(
    route.query.targetOrigin,
    { allowHttpLocalhost: allowLocalTargets },
  )
  const nonce = readSsoNonce(route.query.nonce)
  const codeChallengeRaw = Array.isArray(route.query.codeChallenge) ? route.query.codeChallenge[0] : route.query.codeChallenge
  const codeChallengeMethodRaw = Array.isArray(route.query.codeChallengeMethod) ? route.query.codeChallengeMethod[0] : route.query.codeChallengeMethod
  const codeChallenge = typeof codeChallengeRaw === 'string' && /^[\w-]{43}$/.test(codeChallengeRaw)
    ? codeChallengeRaw
    : ''
  const codeChallengeMethod = codeChallengeMethodRaw === 'S256' ? 'S256' : ''
  const legacyRedirect = allowLegacyRedirect
    && mode === 'redirect'
    && !codeChallengeRaw
    && !codeChallengeMethodRaw

  // redirect 模式（顶层重定向，抗存储分区）：回跳地址必须存在且其 origin 在白名单内
  // ——否则就是开放重定向漏洞。非 redirect 模式不需要 returnUrl。
  const returnUrl = mode === 'redirect'
    ? (readSsoReturnUrl as (raw: unknown, options?: { allowHttpLocalhost?: boolean }) => string)(
        route.query.returnUrl,
        { allowHttpLocalhost: allowLocalTargets },
      )
    : ''
  const returnOk = mode !== 'redirect'
    || (!!returnUrl && new URL(returnUrl).origin === targetOrigin && isAllowedTarget(targetOrigin))

  const hasPkce = !!codeChallenge && codeChallengeMethod === 'S256'
  if (!targetOrigin || !nonce || (!hasPkce && !legacyRedirect) || !isAllowedTarget(targetOrigin) || !returnOk) {
    postInvalidRequest(targetOrigin, nonce)
    return
  }

  try {
    const { data, error } = await auth.getSession()
    if (error)
      throw error
    const session = data?.session
    if (session && !isAnonymousSession(session)) {
      if (legacyRedirect) {
        const ticket = await mintLegacyRedirectTicket()
        redirectBack(returnUrl, encodeLegacyRedirectTicket(nonce, ticket))
        return
      }
      if (!hasPkce)
        throw new Error('pkce_required')
      const code = await issueSsoCode({
        mode,
        targetOrigin,
        nonce,
        codeChallenge,
        codeChallengeMethod: 'S256',
        ...(returnUrl ? { returnUrl } : {}),
      })

      if (mode === 'redirect') {
        // Compatibility cast is removed once @yunlefun/sso >= 0.4.0 is installed here.
        redirectBack(returnUrl, encodeSsoRedirectResult(
          { nonce, ok: true, code } as Parameters<typeof encodeSsoRedirectResult>[0] & { code: string },
        ))
        return
      }

      // iframe / popup compatibility channel carries the same one-time code, never a session.
      const payload = { type: SSO_RESULT_TYPE, ok: true, nonce, code } as SsoResultMessage & { code: string }
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
  <div class="mx-auto flex w-full max-w-[21rem] min-w-0 flex-col items-center text-center space-y-6">
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

    <div class="w-full min-w-0 space-y-2">
      <h1 class="text-2xl font-bold">
        账号同步
      </h1>
      <p class="mx-auto max-w-full whitespace-normal break-words text-center text-sm leading-6 text-muted [overflow-wrap:anywhere]">
        {{ message }}
      </p>
    </div>
  </div>
</template>
