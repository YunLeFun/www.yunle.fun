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
import YlfProgress from '@yunlefun/vue/components/YlfProgress.vue'
import AppProductIcon from '~/components/apps/AppProductIcon.vue'
import { useAuthAcquisition } from '~/composables/auth/useAcquisition'
import { useTcbAuthSession } from '~/composables/auth/useAuthSession'
import { resolveSsoClientPresentation } from '~/config/sso-explorer'
import { readableHost } from '~/utils/auth-entry'
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
const { ssoAcquisition } = useAuthAcquisition(app, auth)

const status = shallowRef<'checking' | 'confirmation' | 'success' | 'error'>('checking')
const message = shallowRef('正在确认你的云乐坊账号…')

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

// 展示用：哪个应用在请求登录。签发仍以 sso-ticket 的注册表校验为准。
const requestedClientId = readSsoClientId(route.query.client_id)
const requestedRedirectUri = readSsoRedirectUri(route.query.redirect_uri)
const resolvedClient = requestedClientId && requestedRedirectUri
  ? resolveSsoClientPresentation(requestedClientId, requestedRedirectUri)
  : null
// 回调地址未登记时不借用应用品牌，只显示真实域名
const client = resolvedClient?.verified ? resolvedClient : null
const clientHost = readableHost(requestedRedirectUri)
const clientName = client?.name ?? (clientHost || '应用')
const heading = computed(() => {
  if (status.value === 'error')
    return '暂时无法登录'
  if (status.value === 'confirmation')
    return `登录 ${clientName}`
  if (status.value === 'success')
    return `正在返回 ${clientName}`
  return client ? `正在登录 ${clientName}` : '账号同步'
})

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
      ...ssoAcquisition(input.clientId, input.returnUrl, input.nonce),
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
  message.value = '登录成功，即将返回应用。'
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

function retry(): void {
  window.location.reload()
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
      message.value = '确认使用以下账号继续。'
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
  <section class="min-w-0 space-y-5" aria-labelledby="sso-heading">
    <div class="flex min-w-0 items-start gap-3">
      <span class="sso-app shrink-0" aria-hidden="true">
        <Icon v-if="status === 'error'" name="i-lucide-circle-alert" class="size-6 text-error" />
        <AppProductIcon
          v-else-if="client?.logoUrl"
          :app="{ appId: client.appId, logoUrl: client.logoUrl, fallbackMark: client.fallbackMark }"
        />
        <span v-else-if="client" class="text-lg font-semibold text-primary">{{ client.fallbackMark }}</span>
        <Icon v-else name="i-lucide-globe" class="size-6 text-muted" />
      </span>
      <div class="min-w-0 space-y-1">
        <h1 id="sso-heading" class="ylf-title [overflow-wrap:anywhere]">
          {{ heading }}
        </h1>
        <p v-if="clientHost" class="text-xs leading-5 [overflow-wrap:anywhere]" :class="client ? 'text-muted' : 'text-warning'">
          {{ clientHost }}
        </p>
      </div>
    </div>

    <div v-if="status === 'checking' || status === 'success'" class="sso-progress-scene">
      <CuteCloud shape="small" :animated="false" class="sso-traveler" :class="{ 'sso-traveler--arrived': status === 'success' }" />
      <YlfProgress :value="null" class="sso-progress" :aria-label="heading" />
    </div>
    <p class="text-sm leading-6 text-muted" role="status" aria-live="polite">
      {{ message }}
    </p>

    <template v-if="status === 'confirmation'">
      <div class="sso-account flex min-w-0 items-center gap-3">
        <MemberAvatar v-if="user" :src="user.avatar" :alt="currentAccountName" size="md" />
        <Icon v-else name="i-lucide-user-round" class="size-6 shrink-0 text-muted" />
        <div class="min-w-0">
          <p class="text-sm font-medium [overflow-wrap:anywhere]">
            {{ currentAccountName }}
          </p>
          <p v-if="user?.login" class="text-xs text-muted [overflow-wrap:anywhere]">
            @{{ user.login }}
          </p>
        </div>
      </div>
      <p class="text-sm leading-6 text-muted">
        {{ clientName }} 将获得你的昵称和头像，用于登录。不会共享你的密码。
      </p>
      <p v-if="!client" class="text-sm leading-6 text-warning" role="note">
        未能核验来源，请确认你信任此应用。
      </p>
      <div class="grid gap-2">
        <AppButton block size="lg" data-testid="sso-continue-current-account" @click="continueWithCurrentAccount">
          继续
        </AppButton>
        <AppButton
          v-if="accountSwitchAllowed"
          block
          size="lg"
          color="neutral"
          variant="outline"
          data-testid="sso-use-other-account"
          @click="loginWithOtherAccount"
        >
          使用其他账号
        </AppButton>
        <AppButton block size="lg" color="neutral" variant="ghost" data-testid="sso-deny-authorization" @click="denyAuthorization">
          取消
        </AppButton>
      </div>
    </template>
    <div v-else-if="status === 'error'" class="grid gap-2">
      <AppButton block size="lg" @click="retry">
        重试
      </AppButton>
      <AppButton block size="lg" color="neutral" variant="ghost" to="/">
        返回云乐坊首页
      </AppButton>
    </div>
  </section>
</template>

<style scoped>
.sso-app {
  --app-icon-size: 2.5rem;

  display: grid;
  width: 2.5rem;
  height: 2.5rem;
  place-items: center;
}

.sso-progress {
  height: 4px;
}

.sso-progress-scene {
  position: relative;
  padding-top: 0.5rem;
}

.sso-traveler {
  position: absolute;
  z-index: 1;
  top: -0.125rem;
  left: calc(50% - 0.75rem);
  width: 1.5rem;
  filter: drop-shadow(0 1px 2px color-mix(in srgb, var(--ylf-c-brand) 24%, transparent));
  animation: sso-cloud-glide calc(var(--ylf-duration-slow) * 5) var(--ylf-ease-standard) infinite alternate;
}

.sso-traveler--arrived {
  animation: none;
  transform: translateX(2rem);
}

@keyframes sso-cloud-glide {
  from {
    transform: translateX(-2rem);
  }
  to {
    transform: translateX(2rem);
  }
}

@media (prefers-reduced-motion: reduce) {
  .sso-traveler {
    animation: none;
  }
}

.sso-account {
  padding-block: var(--ylf-space-3);
  border-block: 1px solid var(--ylf-c-border);
}
</style>
