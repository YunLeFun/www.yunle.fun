<script setup lang="ts">
import {
  encodeSsoRedirectResult,
  isAnonymousSession,
  readSsoClientId,
  readSsoCodeChallenge,
  readSsoCodeChallengeMethod,
  readSsoNonce,
  readSsoPrompt,
  readSsoRedirectUri,
  readSsoScope,
  SSO_REDIRECT_HASH_KEY,
} from '@yunlefun/sso/protocol'
import { useTcbAuthSession } from '~/composables/auth/useAuthSession'
import {
  buildNativeSsoCallbackUrl,
  readNativeSsoCallbackUri,
} from '~/utils/native-sso-callback'

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
const { authReady, authStatus, checkAuthStatus, logout, user } = useTcbAuthSession()

const status = shallowRef<'checking' | 'confirmation' | 'success' | 'error'>('checking')
const message = shallowRef('正在同步云乐坊账号...')

interface PendingAuthorization {
  clientId: string
  targetOrigin: string
  returnUrl: string
  scope: string
  nonce: string
  codeChallenge: string
}

const pendingAuthorization = shallowRef<PendingAuthorization | null>(null)
const accountSwitchAllowed = shallowRef(false)
const currentAccountName = computed(() => user.value?.nickname || user.value?.login || '云乐坊账号')
let nativeCallbackUri: string | null = null

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
  window.location.replace(resultDestination(url.toString()))
}

function redirectDenied(redirectUri: string, nonce: string): void {
  const url = new URL(redirectUri)
  url.hash = `${SSO_REDIRECT_HASH_KEY}=${encodeSsoRedirectResult({
    nonce,
    issuer: window.location.origin,
    ok: false,
    reason: 'access_denied',
  })}`
  status.value = 'success'
  message.value = '已取消授权，正在返回…'
  window.location.replace(resultDestination(url.toString()))
}

function resultDestination(resultUrl: string): string {
  return nativeCallbackUri
    ? buildNativeSsoCallbackUrl(nativeCallbackUri, resultUrl)
    : resultUrl
}

function rejectInvalidRequest(): void {
  status.value = 'error'
  message.value = 'SSO 请求参数无效。'
  console.warn('[sso] rejected invalid SSO v3 request')
}

async function authorize(request: PendingAuthorization): Promise<void> {
  status.value = 'checking'
  message.value = '正在获取一次性授权…'
  const code = await issueSsoCode(request)
  redirectBack(request.returnUrl, request.nonce, code)
}

async function continueWithCurrentAccount(): Promise<void> {
  const request = pendingAuthorization.value
  if (!request || status.value !== 'confirmation')
    return
  try {
    await authorize(request)
  }
  catch (error) {
    handleAuthorizationFailure(error)
  }
}

function denyAuthorization(): void {
  const request = pendingAuthorization.value
  if (!request || status.value !== 'confirmation')
    return
  redirectDenied(request.returnUrl, request.nonce)
}

async function loginWithOtherAccount(): Promise<void> {
  const returnTo = router.currentRoute.value.fullPath
  status.value = 'checking'
  message.value = '正在准备其他账号登录…'
  try {
    await logout()
    await navigateTo({
      path: '/login',
      query: { redirect: returnTo },
    })
  }
  catch (error) {
    handleAuthorizationFailure(error)
  }
}

function handleAuthorizationFailure(error: unknown): void {
  console.error('[sso] authorization failed:', error)
  status.value = 'error'
  message.value = 'SSO 请求未获授权，请检查客户端注册或稍后重试。'
}

onMounted(async () => {
  const clientId = readSsoClientId(route.query.client_id)
  const redirectUri = readSsoRedirectUri(route.query.redirect_uri)
  const scopes = readSsoScope(route.query.scope)
  const nonce = readSsoNonce(route.query.nonce)
  const codeChallenge = readSsoCodeChallenge(route.query.code_challenge)
  const codeChallengeMethod = readSsoCodeChallengeMethod(route.query.code_challenge_method)
  const rawPrompt = Array.isArray(route.query.prompt)
    ? String(route.query.prompt[0] ?? '')
    : String(route.query.prompt ?? '')
  const prompt = readSsoPrompt(rawPrompt)
  const rawNativeCallback = Array.isArray(route.query.native_callback_uri)
    ? String(route.query.native_callback_uri[0] ?? '')
    : String(route.query.native_callback_uri ?? '')
  const parsedNativeCallback = rawNativeCallback
    ? readNativeSsoCallbackUri(rawNativeCallback)
    : null
  if (!clientId
    || !redirectUri
    || !scopes.length
    || !nonce
    || !codeChallenge
    || codeChallengeMethod !== 'S256'
    || (rawPrompt && !prompt)
    || (rawNativeCallback && !parsedNativeCallback)
    || (parsedNativeCallback && prompt !== 'select_account')) {
    rejectInvalidRequest()
    return
  }
  nativeCallbackUri = parsedNativeCallback

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

    const request = {
      clientId,
      targetOrigin: new URL(redirectUri).origin,
      returnUrl: redirectUri,
      scope: scopes.join(' '),
      nonce,
      codeChallenge,
    }
    pendingAuthorization.value = request
    if (prompt === 'consent' || prompt === 'select_account') {
      accountSwitchAllowed.value = prompt === 'select_account'
      status.value = 'confirmation'
      message.value = '确认用于登录的云乐坊账号。'
      return
    }
    await authorize(request)
  }
  catch (error) {
    handleAuthorizationFailure(error)
  }
})
</script>

<template>
  <div class="mx-auto flex w-full max-w-[21rem] min-w-0 flex-col items-center text-center space-y-6">
    <div class="flex justify-center">
      <Icon
        v-if="status === 'checking'"
        name="i-lucide-loader-circle"
        class="h-14 w-14 animate-spin text-primary"
      />
      <Icon
        v-else-if="status === 'confirmation'"
        name="i-lucide-user-round-check"
        class="h-14 w-14 text-primary"
      />
      <Icon
        v-else-if="status === 'success'"
        name="i-lucide-check-circle"
        class="h-14 w-14 text-green-500"
      />
      <Icon
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

    <div v-if="status === 'confirmation'" class="w-full space-y-4 text-left">
      <div class="flex items-center gap-3 rounded-2xl border border-default bg-default/70 p-4">
        <img
          v-if="user?.avatar"
          :src="user.avatar"
          :alt="currentAccountName"
          class="h-11 w-11 rounded-full object-cover"
        >
        <div v-else class="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Icon name="i-lucide-user-round" class="h-5 w-5" />
        </div>
        <div class="min-w-0 flex-1">
          <strong class="block truncate text-sm">{{ currentAccountName }}</strong>
          <span v-if="user?.login" class="block truncate text-xs text-muted">@{{ user.login }}</span>
        </div>
      </div>

      <p class="text-center text-xs leading-5 text-muted">
        应用只会获得用于建立独立会话的一次性身份授权，不会获得密码或云乐坊长期令牌。
      </p>

      <div class="grid gap-2">
        <AppButton
          block
          size="lg"
          data-testid="sso-continue-current-account"
          @click="continueWithCurrentAccount"
        >
          继续使用此账号
        </AppButton>
        <AppButton
          v-if="accountSwitchAllowed"
          block
          size="lg"
          color="neutral"
          variant="soft"
          data-testid="sso-use-other-account"
          @click="loginWithOtherAccount"
        >
          使用其他账号
        </AppButton>
        <AppButton
          block
          size="lg"
          color="neutral"
          variant="ghost"
          data-testid="sso-deny-authorization"
          @click="denyAuthorization"
        >
          取消
        </AppButton>
      </div>
    </div>
  </div>
</template>
