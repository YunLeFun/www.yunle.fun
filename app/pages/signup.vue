<script setup lang="ts">
import type { TcbSignUpData } from '~/composables/useTcbAuth'

definePageMeta({
  layout: 'auth',
})

useSeoMeta({
  title: '注册 - 云乐坊',
  description: '注册云乐坊账号，开始您的旅程',
})

const {
  signUpWithPhone,
  verifySignUpOtp,
  loading,
  isAuthenticated,
} = useTcbAuth()
const router = useRouter()

// 如果已登录，重定向到首页
watch(isAuthenticated, (value) => {
  if (value) {
    router.push('/')
  }
}, { immediate: true })

// 注册步骤
type Step = 'info' | 'verify'
const step = ref<Step>('info')

// 表单状态
const phone = ref('')
const otpCode = ref('')
const signUpData = ref<TcbSignUpData | null>(null)
const countdown = ref(0)
let countdownTimer: ReturnType<typeof setInterval> | null = null

// 区号选项（当前仅支持中国大陆）
const phoneAreaCodes = [
  { label: '+86', value: '+86', hint: '中国大陆' },
]
const phoneAreaCode = ref('+86')

// 手机号校验（根据区号匹配规则）
const phoneValid = computed(() => {
  if (phoneAreaCode.value === '+86') {
    return /^1[3-9]\d{9}$/.test(phone.value)
  }
  return phone.value.length >= 6
})
const formValid = computed(() => phoneValid.value)

// 发送注册验证码
async function handleSignUp() {
  if (!formValid.value)
    return
  try {
    signUpData.value = await signUpWithPhone(phone.value)
    step.value = 'verify'
    startCountdown()
  }
  catch {
    // 错误已在 composable 中处理
  }
}

// 验证注册码
async function handleVerify() {
  if (!signUpData.value || !otpCode.value)
    return
  try {
    await verifySignUpOtp(signUpData.value, otpCode.value)
  }
  catch {
    // 错误已在 composable 中处理
  }
}

// 重新发送
async function handleResend() {
  try {
    signUpData.value = await signUpWithPhone(phone.value)
    startCountdown()
  }
  catch {
    // 错误已在 composable 中处理
  }
}

// 倒计时
function startCountdown() {
  countdown.value = 60
  if (countdownTimer)
    clearInterval(countdownTimer)
  countdownTimer = setInterval(() => {
    countdown.value--
    if (countdown.value <= 0) {
      clearInterval(countdownTimer!)
      countdownTimer = null
    }
  }, 1000)
}

// 返回信息填写步骤
function goBackToInfo() {
  step.value = 'info'
  otpCode.value = ''
}

onUnmounted(() => {
  if (countdownTimer)
    clearInterval(countdownTimer)
})
</script>

<template>
  <div class="w-full space-y-6">
    <!-- 标题区域 -->
    <div class="text-center space-y-2">
      <div class="flex justify-center">
        <UIcon
          name="i-lucide-user-plus"
          class="text-3xl text-primary"
        />
      </div>
      <h1 class="text-2xl font-bold">
        注册云乐坊
      </h1>
      <p class="text-sm text-muted">
        {{ step === 'info' ? '使用手机号注册云乐坊账号' : `验证码已发送至 ${phoneAreaCode} ${phone}` }}
      </p>
    </div>

    <!-- 步骤 1: 填写信息 -->
    <div v-if="step === 'info'" class="space-y-4">
      <UFormField label="手机号" required>
        <div class="flex gap-2">
          <USelect
            v-model="phoneAreaCode"
            :items="phoneAreaCodes"
            value-key="value"
            size="lg"
            class="w-24 shrink-0"
            :disabled="loading"
          />
          <UInput
            v-model="phone"
            placeholder="请输入手机号"
            size="lg"
            icon="i-lucide-smartphone"
            :disabled="loading"
            class="flex-1"
            @keyup.enter="handleSignUp"
          />
        </div>
        <template #hint>
          <span class="text-xs text-dimmed">当前仅支持中国大陆手机号</span>
        </template>
      </UFormField>

      <UButton
        label="获取验证码"
        color="primary"
        size="lg"
        block
        :loading="loading"
        :disabled="!formValid"
        @click="handleSignUp"
      />

    </div>

    <!-- 步骤 2: 验证码验证 -->
    <div v-else class="space-y-4">
      <UFormField label="验证码">
        <div class="flex gap-2">
          <UInput
            v-model="otpCode"
            placeholder="输入 6 位验证码"
            size="lg"
            icon="i-lucide-shield-check"
            maxlength="6"
            :disabled="loading"
            class="flex-1"
            @keyup.enter="handleVerify"
          />
          <UButton
            :label="countdown > 0 ? `${countdown}s` : '重新发送'"
            color="neutral"
            variant="outline"
            size="lg"
            :disabled="countdown > 0 || loading"
            @click="handleResend"
          />
        </div>
      </UFormField>

      <UButton
        label="完成注册"
        color="primary"
        size="lg"
        block
        :loading="loading"
        :disabled="!otpCode || otpCode.length < 4"
        @click="handleVerify"
      />

      <UButton
        label="返回修改"
        color="neutral"
        variant="ghost"
        size="lg"
        block
        icon="i-lucide-arrow-left"
        @click="goBackToInfo"
      />
    </div>

    <!-- 登录链接 -->
    <p class="text-center text-sm text-muted">
      已有云乐坊账号？<ULink
        to="/login"
        class="text-primary font-medium"
      >
        立即登录
      </ULink>
    </p>

    <!-- 服务条款 -->
    <p class="text-center text-xs text-dimmed">
      注册即表示您同意我们的
      <ULink to="/docs/terms-of-service" class="text-primary font-medium">
        服务条款
      </ULink>
      和
      <ULink to="/docs/privacy-policy" class="text-primary font-medium">
        隐私政策
      </ULink>
    </p>
  </div>
</template>
