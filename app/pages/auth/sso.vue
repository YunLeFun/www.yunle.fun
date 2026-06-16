<script setup lang="ts">
import type { SsoResultMessage } from '@yunlefun/sso/protocol'
import {
  isAnonymousSession,
  readSsoMode,
  readSsoNonce,
  readSsoTargetOrigin,
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
const { auth } = useCloudbase()
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

onMounted(async () => {
  const mode = readSsoMode(route.query.mode)
  const targetOrigin = readSsoTargetOrigin(route.query.targetOrigin)
  const nonce = readSsoNonce(route.query.nonce)

  if (!targetOrigin || !nonce || !isAllowedTarget(targetOrigin)) {
    postInvalidRequest(targetOrigin, nonce)
    return
  }

  try {
    const { data } = await auth.getSession()
    const session = data?.session
    if (session && !isAnonymousSession(session)) {
      postToRequester(targetOrigin, {
        type: SSO_RESULT_TYPE,
        ok: true,
        nonce,
        session,
      })
      return
    }

    if (mode === 'interactive') {
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
