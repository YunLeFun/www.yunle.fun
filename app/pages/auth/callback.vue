<script setup lang="ts">
/**
 * 通用 OAuth 回调页面
 *
 * 同时处理两种场景：
 * 1. OAuth 登录回调（GitHub / 微信）— 在当前窗口中完成，跳转到目标页
 * 2. OAuth 绑定回调（弹窗模式）— 通过 postMessage 通知父窗口，然后自动关闭
 *
 * 通过 localStorage 中的 auth_link_provider 标记区分：
 * - 存在 → 绑定模式（弹窗），处理完成后 postMessage 通知父窗口并关闭自身
 * - 不存在 → 登录模式，完成后跳转到首页或指定页面
 */

definePageMeta({
  layout: 'auth',
})

const router = useRouter()
const { checkAuthStatus, fetchUser, isAuthenticated, user } = useTcbAuth()
const toast = useToast()

const status = ref<'checking' | 'success' | 'error'>('checking')
const message = ref('正在处理中...')
const isBinding = ref(false)
const isPopup = ref(false)

onMounted(async () => {
  const linkProvider = localStorage.getItem('auth_link_provider')
  isBinding.value = !!linkProvider
  isPopup.value = !!window.opener

  try {
    // CloudBase SDK detectSessionInUrl: true 会自动处理 URL 中的 OAuth 回调参数
    await new Promise(resolve => setTimeout(resolve, 500))

    if (isBinding.value) {
      // 绑定模式
      localStorage.removeItem('auth_link_provider')

      status.value = 'success'
      message.value = '绑定成功！'

      if (isPopup.value) {
        // 弹窗模式：通过 postMessage 通知父窗口，然后关闭弹窗
        message.value = '绑定成功，窗口即将关闭...'
        window.opener.postMessage(
          { type: 'oauth_callback', success: true, provider: linkProvider },
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
          description: `已成功绑定${linkProvider === 'github' ? ' GitHub' : '微信'}账号`,
          color: 'success',
        })
        const redirect = localStorage.getItem('auth_redirect') || '/settings?tab=security'
        localStorage.removeItem('auth_redirect')
        setTimeout(() => router.push(redirect), 1000)
      }
    }
    else {
      // 登录模式
      await checkAuthStatus()

      if (isAuthenticated.value && user.value) {
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
        return
      }

      throw new Error('未能获取用户信息，请重试')
    }
  }
  catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error('OAuth 回调处理失败:', err)
    status.value = 'error'
    message.value = errMsg || '操作失败，请重试'

    localStorage.removeItem('auth_link_provider')
    localStorage.removeItem('auth_redirect')

    if (isPopup.value) {
      // 弹窗模式：通知父窗口失败
      window.opener?.postMessage(
        { type: 'oauth_callback', success: false, error: errMsg },
        window.location.origin,
      )
      setTimeout(() => window.close(), 2000)
    }
    else {
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
      <UIcon
        v-if="status === 'checking'"
        name="i-lucide-loader-circle"
        class="w-16 h-16 text-primary animate-spin"
      />
      <UIcon
        v-else-if="status === 'success'"
        name="i-lucide-check-circle"
        class="w-16 h-16 text-green-500"
      />
      <UIcon
        v-else
        name="i-lucide-x-circle"
        class="w-16 h-16 text-red-500"
      />
    </div>

    <div class="space-y-2">
      <h1 class="text-2xl font-bold">
        <span v-if="status === 'checking'">处理中</span>
        <span v-else-if="status === 'success'">{{ isBinding ? '绑定成功' : '登录成功' }}</span>
        <span v-else>{{ isBinding ? '绑定失败' : '登录失败' }}</span>
      </h1>
      <p class="text-gray-600 dark:text-gray-400">
        {{ message }}
      </p>
    </div>

    <div v-if="status === 'error'" class="flex justify-center gap-3">
      <UButton
        v-if="isBinding"
        to="/settings?tab=security"
        color="primary"
        size="lg"
      >
        返回设置页
      </UButton>
      <UButton
        v-else
        to="/login"
        color="primary"
        size="lg"
      >
        返回登录页
      </UButton>
    </div>
  </div>
</template>
