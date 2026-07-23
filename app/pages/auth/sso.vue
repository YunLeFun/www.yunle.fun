<script setup lang="ts">
import {
  encodeSsoRedirectResult,
  isAnonymousSession,
  readSsoClientId,
  readSsoCodeChallenge,
  readSsoCodeChallengeMethod,
  readSsoNonce,
  readSsoRedirectUri,
  readSsoScope,
  SSO_REDIRECT_HASH_KEY,
} from '@yunlefun/sso/protocol'
import { useTcbAuthSession } from '~/composables/auth/useAuthSession'

definePageMeta({
  layout: 'auth',
})

useSeoMeta({
  title: '账号同步 - 云乐坊',
  robots: 'noindex,nofollow',
})

useHead({
  meta: [{ name: 'referrer', content: 'no-referrer' }],
})

const route = useRoute()
const router = useRouter()
const { app, auth } = useCloudbase()
const { authReady, authStatus, checkAuthStatus } = useTcbAuthSession()

const status = shallowRef<'checking' | 'success' | 'error'>('checking')
const message = shallowRef('正在同步云乐坊账号...')

interface SsoCodeResult {
  ok?: boolean
  code?: unknown
  reason?: unknown
}

function readSsoCodeResult(response: unknown): SsoCodeResult {
  if (!response || typeof response !== 'object' || Array.isArray(response))
    return {}
  const record = response as Record<string, unknown>
  const nested = record.result
  return nested && typeof nested === 'object' && !Array.isArray(nested)
    ? nested as SsoCodeResult
    : record as SsoCodeResult
}

async function issueSsoCode(input: {
  clientId: string
  targetOrigin: string
  returnUrl: string
  scope: string
  nonce: string
  codeChallenge: string
}): Promise<string> {
  const result = readSsoCodeResult(await app.callFunction({
    name: 'sso-ticket',
    data: {
      action: 'issueSsoCode',
      mode: 'redirect',
      ...input,
      codeChallengeMethod: 'S256',
    },
  }))
  if (result.ok !== true || typeof result.code !== 'string' || !/^[\w-]{43}$/.test(result.code))
    throw new Error(typeof result.reason === 'string' ? result.reason : 'code_issue_failed')
  return result.code
}

function redirectBack(redirectUri: string, nonce: string, code: string): void {
  const url = new URL(redirectUri)
  url.hash = `${SSO_REDIRECT_HASH_KEY}=${encodeSsoRedirectResult({
    nonce,
    issuer: window.location.origin,
    ok: true,
    code,
  })}`
  status.value = 'success'
  message.value = '账号已同步，正在返回…'
  window.location.replace(url.toString())
}

function rejectInvalidRequest(): void {
  status.value = 'error'
  message.value = 'SSO 请求参数无效。'
  console.warn('[sso] rejected invalid SSO v3 request')
}

onMounted(async () => {
  const clientId = readSsoClientId(route.query.client_id)
  const redirectUri = readSsoRedirectUri(route.query.redirect_uri)
  const scopes = readSsoScope(route.query.scope)
  const nonce = readSsoNonce(route.query.nonce)
  const codeChallenge = readSsoCodeChallenge(route.query.code_challenge)
  const codeChallengeMethod = readSsoCodeChallengeMethod(route.query.code_challenge_method)
  if (!clientId
    || !redirectUri
    || !scopes.length
    || !nonce
    || !codeChallenge
    || codeChallengeMethod !== 'S256') {
    rejectInvalidRequest()
    return
  }

  try {
    if (!authReady.value)
      await checkAuthStatus()

    if (authStatus.value === 'guest') {
      await navigateTo({
        path: '/login',
        query: { redirect: router.currentRoute.value.fullPath },
      })
      return
    }

    const { data, error } = await auth.getSession()
    if (error)
      throw error
    const session = data?.session
    if (!session || isAnonymousSession(session)) {
      await navigateTo({
        path: '/login',
        query: { redirect: router.currentRoute.value.fullPath },
      })
      return
    }

    const code = await issueSsoCode({
      clientId,
      targetOrigin: new URL(redirectUri).origin,
      returnUrl: redirectUri,
      scope: scopes.join(' '),
      nonce,
      codeChallenge,
    })
    redirectBack(redirectUri, nonce, code)
  }
  catch (error) {
    console.error('[sso] authorization failed:', error)
    status.value = 'error'
    message.value = 'SSO 请求未获授权，请检查客户端注册或稍后重试。'
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
