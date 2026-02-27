<script setup lang="ts">
/**
 * GitHub OAuth 回调页面
 *
 * 基于 CloudBase Auth SDK 的 OAuth 流程：
 * 1. 用户在登录页点击 GitHub 登录
 * 2. CloudBase signInWithOAuth 生成授权 URL，跳转到 GitHub
 * 3. GitHub 授权后回调到 CloudBase 静态域名 /__auth/
 * 4. CloudBase SDK 的 detectSessionInUrl 自动处理回调参数
 * 5. 此页面检查 session 状态并跳转到目标页面
 */

definePageMeta({
  layout: 'auth',
})

const router = useRouter()
const { checkAuthStatus, isAuthenticated, user } = useTcbAuth()
const toast = useToast()

const status = ref<'checking' | 'success' | 'error'>('checking')
const message = ref('正在处理登录...')

onMounted(async () => {
  try {
    // CloudBase SDK detectSessionInUrl: true 会在页面加载时自动处理 URL 中的 OAuth 回调参数
    // 等待 SDK 处理完成
    await new Promise(resolve => setTimeout(resolve, 500))

    // 检查 CloudBase Auth 会话
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
  catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error('GitHub 登录回调处理失败:', err)
    status.value = 'error'
    message.value = errMsg || '登录失败，请重试'

    toast.add({
      title: '登录失败',
      description: errMsg || '请重新尝试',
      color: 'error',
    })

    setTimeout(() => {
      router.push('/login')
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
        <span v-else-if="status === 'success'">登录成功</span>
        <span v-else>登录失败</span>
      </h1>
      <p class="text-gray-600 dark:text-gray-400">
        {{ message }}
      </p>
    </div>

    <div class="flex justify-center items-center gap-2 text-sm text-gray-500">
      <UIcon
        name="i-simple-icons-github"
        class="w-5 h-5"
      />
      <span>GitHub 登录</span>
    </div>

    <div v-if="status === 'error'">
      <UButton
        to="/login"
        color="primary"
        size="lg"
      >
        返回登录页
      </UButton>
    </div>
  </div>
</template>
