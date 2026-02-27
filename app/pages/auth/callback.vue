<script setup lang="ts">
/**
 * 通用 OAuth 回调页面
 *
 * 同时处理两种场景：
 * 1. OAuth 登录回调（GitHub / 微信）
 * 2. OAuth 绑定回调（linkIdentity 完成后的回调）
 *
 * 通过 localStorage 中的 auth_link_provider 标记区分：
 * - 存在 → 绑定模式，完成后跳转到设置页
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

onMounted(async () => {
  const linkProvider = localStorage.getItem('auth_link_provider')
  isBinding.value = !!linkProvider

  try {
    // CloudBase SDK detectSessionInUrl: true 会自动处理 URL 中的 OAuth 回调参数
    await new Promise(resolve => setTimeout(resolve, 500))

    if (isBinding.value) {
      // 绑定模式：刷新用户信息
      localStorage.removeItem('auth_link_provider')
      await fetchUser()

      status.value = 'success'
      message.value = '绑定成功！正在跳转...'

      toast.add({
        title: '绑定成功',
        description: `已成功绑定${linkProvider === 'github' ? ' GitHub' : '微信'}账号`,
        color: 'success',
      })

      const redirect = localStorage.getItem('auth_redirect') || '/settings#security'
      localStorage.removeItem('auth_redirect')

      setTimeout(() => {
        router.push(redirect)
      }, 1000)
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

        const redirect = localStorage.getItem('auth_redirect') || '/'
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

    toast.add({
      title: isBinding.value ? '绑定失败' : '登录失败',
      description: errMsg || '请重新尝试',
      color: 'error',
    })

    setTimeout(() => {
      router.push(isBinding.value ? '/settings#security' : '/login')
    }, 3000)
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
        to="/settings#security"
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
