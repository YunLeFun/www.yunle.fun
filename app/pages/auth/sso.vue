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
  message.value = '登录成功，正在乘云返回…'
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
      message.value = `${clientName} 请求使用你的云乐坊账号登录。`
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
  <div class="mx-auto flex w-full max-w-[21rem] min-w-0 flex-col items-center text-center space-y-5">
    <AuthRoute
      v-if="status !== 'error'"
      class="w-full"
      :from-label="user ? currentAccountName : '云乐坊账号'"
      :to-label="clientName"
      :to-hint="clientHost"
      :to-hint-tone="client ? 'safe' : 'warning'"
      :accent="client?.accent"
      :state="status === 'checking' ? 'flying' : status === 'success' ? 'arrived' : 'idle'"
    >
      <template #from>
        <MemberAvatar
          v-if="user"
          :src="user.avatar"
          :alt="currentAccountName"
          size="xl"
          class="sso-avatar"
        />
        <span v-else class="sso-brand ylf-gradient-tile">
          <YlfLogo class="h-5 w-7 text-primary-foreground" aria-hidden="true" />
        </span>
      </template>
      <template #to>
        <span class="relative">
          <AppProductIcon
            v-if="client?.logoUrl"
            :app="{ appId: client.appId, logoUrl: client.logoUrl, fallbackMark: client.fallbackMark }"
          />
          <span v-else class="sso-mark" :style="{ color: client?.accent }">
            {{ client?.fallbackMark ?? '' }}
            <Icon v-if="!client" name="i-lucide-globe" class="size-6" />
          </span>
          <Transition name="sso-pop">
            <span v-if="status === 'success'" class="sso-check">
              <Icon name="i-lucide-check" class="size-3.5" />
            </span>
          </Transition>
        </span>
      </template>
    </AuthRoute>

    <div v-else class="sso-error">
      <Icon name="i-lucide-cloud-off" class="size-9" />
    </div>

    <div class="w-full min-w-0 space-y-2">
      <h1 class="font-heading text-2xl font-semibold tracking-tight text-balance [overflow-wrap:anywhere] [word-break:keep-all]">
        {{ heading }}
      </h1>
      <p class="mx-auto max-w-full whitespace-normal break-words text-center text-sm leading-6 text-muted text-balance [overflow-wrap:anywhere] [word-break:keep-all]">
        {{ message }}
      </p>
    </div>

    <div v-if="status === 'confirmation'" class="w-full space-y-4 text-left">
      <div class="sso-account">
        <Icon name="i-lucide-user-round-check" class="size-4 shrink-0 text-primary" />
        <span class="min-w-0 flex-1 truncate">
          以 <strong>{{ currentAccountName }}</strong>
          <span v-if="user?.login" class="text-muted"> @{{ user.login }}</span>
          的身份继续
        </span>
      </div>

      <ul class="sso-grants">
        <li>
          <Icon name="i-lucide-badge-check" class="size-4 shrink-0 text-primary" />
          确认你的云乐坊身份（昵称与头像）
        </li>
        <li>
          <Icon name="i-lucide-key-round" class="size-4 shrink-0 text-primary" />
          应用只会获得用于建立独立会话的一次性身份授权，不会获得密码或云乐坊长期令牌。
        </li>
      </ul>

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

    <div v-else-if="status === 'error'" class="grid w-full gap-2">
      <AppButton block size="lg" icon="i-lucide-rotate-cw" @click="retry">
        重试
      </AppButton>
      <AppButton block size="lg" color="neutral" variant="ghost" to="/">
        返回云乐坊首页
      </AppButton>
    </div>
  </div>
</template>

<style scoped>
.sso-brand,
.sso-mark {
  display: grid;
  width: 3rem;
  height: 3rem;
  place-items: center;
}

.sso-avatar {
  border-radius: 9999px;
  box-shadow:
    0 0 0 3px var(--ylf-surface),
    0 8px 18px -12px var(--ylf-shadow-color);
}

.sso-brand,
.sso-mark {
  border-radius: 22%;
}

.sso-mark {
  background: color-mix(in srgb, currentColor 14%, var(--ylf-surface));
  font-size: 1.125rem;
  font-weight: 700;
}

.sso-check {
  position: absolute;
  right: -0.375rem;
  bottom: -0.375rem;
  display: grid;
  width: 1.375rem;
  height: 1.375rem;
  place-items: center;
  border-radius: 9999px;
  background: var(--ylf-status-success, #16a34a);
  box-shadow: 0 0 0 2px var(--ylf-surface);
  color: #fff;
}

.sso-pop-enter-active {
  transition:
    opacity 160ms ease,
    scale 260ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

.sso-pop-enter-from {
  opacity: 0;
  scale: 0.4;
}

.sso-error {
  display: grid;
  width: 4rem;
  height: 4rem;
  place-items: center;
  border-radius: 1.25rem;
  background: color-mix(in srgb, var(--ylf-status-danger, #dc2626) 10%, var(--ylf-surface));
  color: var(--ylf-status-danger-text, #dc2626);
}

.sso-account {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 0.875rem;
  border: 1px solid var(--ui-border-muted);
  border-radius: 0.875rem;
  background: color-mix(in srgb, var(--ylf-surface-muted) 60%, var(--ylf-surface));
  font-size: 0.875rem;
}

.sso-grants {
  display: grid;
  gap: 0.5rem;
  padding: 0 0.25rem;
  color: var(--ui-text-muted);
  font-size: var(--ylf-type-caption);
  line-height: 1.5;
  text-wrap: pretty;
}

.sso-grants li {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
}

@media (prefers-reduced-motion: reduce) {
  .sso-pop-enter-active {
    transition: none;
  }
}
</style>
