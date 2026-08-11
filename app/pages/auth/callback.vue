<script setup lang="ts">
/**
 * 通用 OAuth 回调页面
 *
 * 处理三种场景：
 * 1. OAuth 登录回调（GitHub / 微信）— 在当前窗口中完成，跳转到目标页
 * 2. OAuth 绑定回调（弹窗模式）— 通过 postMessage 通知父窗口，然后自动关闭
 * 3. 原生 App 回调（state 以 'app-' 开头）— 通过 deeplink 把 code+state 传回 App
 *
 * 通过 localStorage 中的 auth_link_provider 标记区分场景 1/2：
 * - 存在 → 绑定模式（弹窗），处理完成后 postMessage 通知父窗口并关闭自身
 * - 不存在 → 登录模式，完成后跳转到首页或指定页面
 *
 * 场景 3 通过 URL 中 state 参数的 'app-' 前缀识别
 *
 * 注意：SDK 的 detectSessionInUrl 已关闭（见 useCloudbase），
 * code 交换由本页显式完成，确保能拿到真实的登录/绑定结果，
 * 避免 SDK 自动处理完成后 location.replace 整页刷新引发的竞态。
 */

/** 与 apps.yunle.fun 中 NATIVE_OAUTH_STATE_PREFIX 保持一致 */
const NATIVE_OAUTH_STATE_PREFIX = 'app-'

definePageMeta({
  layout: 'auth',
})

const router = useRouter()
const { auth } = useCloudbase()
const { fetchUser, isAuthenticated, user } = useTcbAuth()
const toast = useAppToast()

const status = ref<'checking' | 'success' | 'error'>('checking')
const message = ref('正在处理中...')
const isBinding = ref(false)
const isPopup = ref(false)
const isNativeApp = ref(false)

/**
 * 检测是否来自原生 App (apps.yunle.fun) 的 OAuth 回调
 * 如果是，通过 deeplink 把 code+state 传回 App，不走 Web 端 verifyOAuth
 */
function handleNativeAppCallback(): boolean {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const state = params.get('state')

  if (!state?.startsWith(NATIVE_OAUTH_STATE_PREFIX) || !code)
    return false

  isNativeApp.value = true
  message.value = '正在返回云乐坊 App...'

  // 通过 deeplink 把 code+state 传回原生 App
  const deeplink = `yunlefun://auth/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`
  window.location.href = deeplink

  // 如果 deeplink 没有立即关闭页面（用户可能不在 iOS 设备），显示提示
  setTimeout(() => {
    status.value = 'success'
    message.value = '授权成功，请返回云乐坊 App'
  }, 1500)

  return true
}

/**
 * 从 state 中解析 provider id
 * SDK signInWithOAuth 生成的 state 格式为 `prd-{provider}-{random}`，
 * 如 prd-github-xxx / prd-wx_open-xxx
 */
function providerFromState(state: string | null): string | null {
  const matched = state?.match(/^prd-(.+)-[a-z0-9.]+$/i)
  return matched?.[1] || null
}

/**
 * 提取错误信息
 * SDK 的 grantProviderToken / bindWithProvider 失败时抛出的是
 * 形如 { error, error_description } 的普通对象而非 Error 实例
 */
function extractErrorMessage(err: unknown): string {
  if (err instanceof Error)
    return err.message
  if (err && typeof err === 'object') {
    const e = err as Record<string, unknown>
    const msg = e.error_description || e.message || e.msg || e.error
    if (msg)
      return String(msg)
    try {
      return JSON.stringify(err)
    }
    catch {
      return String(err)
    }
  }
  return String(err)
}

/** 把常见绑定/登录错误转成对用户友好的提示 */
function friendlyAuthError(raw: string, binding: boolean): string {
  if (/already.*(?:bound|bind|exist)|been bound|已绑定|已被绑定/i.test(raw))
    return '该第三方账号已被其他用户绑定，请先在原账号中解绑后再试'
  if (/unauthenticated|credentials not found|登录态/i.test(raw))
    return binding ? '登录态已失效，请重新登录后再绑定' : '登录态校验失败，请重试'
  if (/invalid.*(?:code|grant)|code.*(?:used|expired)/i.test(raw))
    return '授权码已失效，请重新发起授权'
  return raw
}

onMounted(async () => {
  // 先检查是否是原生 App 的回调
  if (handleNativeAppCallback())
    return

  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const state = params.get('state')
  const providerError = params.get('error_description') || params.get('error')

  const linkProvider = localStorage.getItem('auth_link_provider')
  isBinding.value = !!linkProvider
  isPopup.value = !!window.opener

  try {
    // 第三方平台用户拒绝授权等情况会通过 error 参数回调
    if (providerError)
      throw new Error(`授权未完成：${providerError}`)
    if (!code || !state)
      throw new Error('回调参数缺失，请重新发起登录')

    const provider = providerFromState(state) || linkProvider
    if (!provider)
      throw new Error('无法识别第三方平台，请重新发起登录')

    // 显式交换 code 换取 provider_token（绕开 SDK 的自动处理）
    const { provider_token } = await auth.grantProviderToken({
      provider_id: provider,
      provider_redirect_uri: `${window.location.origin}${window.location.pathname.replace(/\/$/, '')}`,
      provider_code: code,
    })

    // 清理发起方写入的 state 缓存（显式处理后 SDK 不会再消费它）
    try {
      sessionStorage.removeItem(state)
    }
    catch {}

    if (isBinding.value) {
      // 绑定模式：绑定到当前登录账号（弹窗与父窗口共享 localStorage 登录态）
      localStorage.removeItem('auth_link_provider')
      await auth.bindWithProvider({ provider_token })

      status.value = 'success'
      message.value = '绑定成功！'

      if (isPopup.value) {
        // 弹窗模式：通过 postMessage 通知父窗口，然后关闭弹窗
        message.value = '绑定成功，窗口即将关闭...'
        window.opener.postMessage(
          { type: 'oauth_callback', success: true, provider },
          window.location.origin,
        )
        setTimeout(() => window.close(), 500)
      }
      else {
        // 非弹窗模式（兜底）：刷新用户信息并跳转
        await fetchUser()
        message.value = '绑定成功！正在跳转...'
        toast.add({
          title: '绑定成功',
          description: `已成功绑定${provider === 'github' ? ' GitHub' : '微信'}账号`,
          color: 'success',
        })
        const redirect = localStorage.getItem('auth_redirect') || '/settings?tab=security'
        localStorage.removeItem('auth_redirect')
        setTimeout(() => router.push(redirect), 1000)
      }
    }
    else {
      // 登录模式：用 provider_token 建立会话
      await auth.signInWithProvider({ provider_token })
      await fetchUser()

      if (!isAuthenticated.value || !user.value)
        throw new Error('未能获取用户信息，请重试')

      status.value = 'success'
      message.value = '登录成功！正在跳转...'

      toast.add({
        title: '登录成功',
        description: `欢迎回来，${user.value.nickname || user.value.login}！`,
        color: 'success',
      })

      const redirect = localStorage.getItem('auth_redirect') || '/profile'
      localStorage.removeItem('auth_redirect')

      setTimeout(() => {
        router.push(redirect)
      }, 1000)
    }
  }
  catch (err: unknown) {
    const errMsg = friendlyAuthError(extractErrorMessage(err), isBinding.value)
    console.error('OAuth 回调处理失败:', err)
    status.value = 'error'
    message.value = errMsg || '操作失败，请重试'

    localStorage.removeItem('auth_link_provider')

    if (isPopup.value) {
      // 弹窗模式：通知父窗口失败
      window.opener?.postMessage(
        { type: 'oauth_callback', success: false, error: errMsg },
        window.location.origin,
      )
      setTimeout(() => window.close(), 2000)
    }
    else {
      localStorage.removeItem('auth_redirect')
      toast.add({
        title: isBinding.value ? '绑定失败' : '登录失败',
        description: errMsg || '请重新尝试',
        color: 'error',
      })
      setTimeout(() => {
        router.push(isBinding.value ? '/settings?tab=security' : '/login')
      }, 3000)
    }
  }
})
</script>

<template>
  <div class="text-center space-y-6">
    <div class="flex justify-center">
      <Icon
        v-if="status === 'checking'"
        name="i-lucide-loader-circle"
        class="w-16 h-16 text-primary animate-spin"
      />
      <Icon
        v-else-if="status === 'success'"
        name="i-lucide-check-circle"
        class="w-16 h-16 text-green-500"
      />
      <Icon
        v-else
        name="i-lucide-x-circle"
        class="w-16 h-16 text-red-500"
      />
    </div>

    <div class="space-y-2">
      <h1 class="text-2xl font-bold">
        <span v-if="status === 'checking'">处理中</span>
        <span v-else-if="isNativeApp">授权成功</span>
        <span v-else-if="status === 'success'">{{ isBinding ? '绑定成功' : '登录成功' }}</span>
        <span v-else>{{ isBinding ? '绑定失败' : '登录失败' }}</span>
      </h1>
      <p class="text-muted">
        {{ message }}
      </p>
    </div>

    <div v-if="status === 'error' && !isNativeApp" class="flex justify-center gap-3">
      <AppButton
        v-if="isBinding"
        to="/settings?tab=security"
        color="primary"
        size="lg"
      >
        返回设置页
      </AppButton>
      <AppButton
        v-else
        to="/login"
        color="primary"
        size="lg"
      >
        返回登录页
      </AppButton>
    </div>
  </div>
</template>
