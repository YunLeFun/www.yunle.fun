<script setup lang="ts">
/**
 * GitHub OAuth 回调页面
 *
 * 流程说明：
 * 1. 用户在登录页点击 GitHub 登录
 * 2. 跳转到 GitHub 授权页面
 * 3. 用户授权后，GitHub 重定向到后端 /auth/github/callback
 * 4. 后端处理完成后，设置 httpOnly Cookie 并重定向到此页面
 * 5. 此页面检查登录状态并跳转到目标页面
 */

definePageMeta({
  layout: 'auth',
})

const router = useRouter()
const { checkAuthStatus, isAuthenticated, user } = useAuth()
const toast = useToast()

// 状态
const status = ref<'checking' | 'success' | 'error'>('checking')
const message = ref('正在处理登录...')

onMounted(async () => {
  try {
    // 等待一小段时间确保 Cookie 已设置
    await new Promise(resolve => setTimeout(resolve, 300))

    // 检查认证状态
    await checkAuthStatus()

    if (isAuthenticated.value && user.value) {
      status.value = 'success'
      message.value = '登录成功！正在跳转...'

      toast.add({
        title: '登录成功',
        description: `欢迎回来，${user.value.nickname || user.value.login}！`,
        color: 'success',
      })

      // 获取重定向地址
      const redirect = localStorage.getItem('auth_redirect') || '/'
      localStorage.removeItem('auth_redirect')

      // 延迟跳转，让用户看到成功消息
      setTimeout(() => {
        router.push(redirect)
      }, 1000)
    }
    else {
      throw new Error('未能获取用户信息')
    }
  }
  catch (err: any) {
    console.error('GitHub 登录回调处理失败:', err)
    status.value = 'error'
    message.value = '登录失败，请重试'

    toast.add({
      title: '登录失败',
      description: err.message || '请重新尝试',
      color: 'error',
    })

    // 3秒后跳转回登录页
    setTimeout(() => {
      router.push('/login')
    }, 3000)
  }
})
</script>

<template>
  <div class="text-center space-y-6">
    <!-- 图标 -->
    <div class="flex justify-center">
      <div
        v-if="status === 'checking'"
        class="relative"
      >
        <UIcon
          name="i-lucide-loader-circle"
          class="w-16 h-16 text-primary animate-spin"
        />
      </div>

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

    <!-- 标题和消息 -->
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

    <!-- GitHub 图标（装饰） -->
    <div class="flex justify-center items-center gap-2 text-sm text-gray-500">
      <UIcon
        name="i-simple-icons-github"
        class="w-5 h-5"
      />
      <span>GitHub 登录</span>
    </div>

    <!-- 返回按钮（仅失败时显示） -->
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
