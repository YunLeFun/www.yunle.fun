<script setup lang="ts">
import type { AuthFormField, ButtonProps, FormSubmitEvent } from '@nuxt/ui'
import * as z from 'zod'

definePageMeta({
  layout: 'auth',
})

useSeoMeta({
  title: '登录 - YunLeFun',
  description: '登录到您的账户以继续',
})

const { loginWithPassword, loginWithGitHub, loading, isAuthenticated } = useAuth()
const router = useRouter()

// 如果已登录，重定向到首页
watch(isAuthenticated, (value) => {
  if (value) {
    router.push('/')
  }
}, { immediate: true })

const fields: AuthFormField[] = [{
  name: 'email',
  type: 'text' as const,
  label: '邮箱',
  placeholder: '输入您的邮箱',
  required: true,
}, {
  name: 'password',
  label: '密码',
  type: 'password' as const,
  placeholder: '输入您的密码',
}, {
  name: 'remember',
  label: '记住我',
  type: 'checkbox' as const,
}]

const providers: ButtonProps[] = [
  {
    label: 'GitHub',
    icon: 'i-simple-icons-github',
    onClick: () => {
      loginWithGitHub()
    },
  },
  {
    label: '微信登录',
    icon: 'i-simple-icons-wechat',
    color: 'success',
    onClick: () => {
      // loginWithWechat()
    },
  },
]

const schema = z.object({
  email: z.email('请输入有效的邮箱地址'),
  password: z.string().min(6, '密码至少需要 6 个字符'),
})

type Schema = z.output<typeof schema>

async function onSubmit(payload: FormSubmitEvent<Schema>) {
  try {
    await loginWithPassword(payload.data.email, payload.data.password)
  }
  catch (error) {
    // 错误已在 composable 中处理
    console.error('Login error:', error)
  }
}
</script>

<template>
  <UAuthForm
    :fields="fields"
    :schema="schema"
    :providers="providers"
    :loading="loading"
    title="欢迎回来"
    description="选择您的登录方式"
    icon="i-lucide-lock"
    submit-button="登录"
    @submit="onSubmit"
  >
    <template #description>
      还没有账户？<ULink
        to="/signup"
        class="text-primary font-medium"
      >
        立即注册
      </ULink>
    </template>

    <template #password-hint>
      <ULink
        to="/forgot-password"
        class="text-primary font-medium"
        tabindex="-1"
      >
        忘记密码？
      </ULink>
    </template>

    <template #footer>
      登录即表示您同意我们的
      <ULink
        to="/terms"
        class="text-primary font-medium"
      >
        服务条款
      </ULink>
      和
      <ULink
        to="/privacy"
        class="text-primary font-medium"
      >
        隐私政策
      </ULink>
    </template>
  </UAuthForm>
</template>
