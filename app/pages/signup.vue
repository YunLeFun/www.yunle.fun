<script setup lang="ts">
import type { TcbSignUpData } from '~/composables/useTcbAuth'

const RE_CN_PHONE = /^1[3-9]\d{9}$/
const RE_OTP = /^\d{6}$/

definePageMeta({
  layout: 'auth',
})

useSeoMeta({
  title: '注册',
  description: '注册云乐坊账号，开始您的旅程',
})

const {
  signUpWithPhone,
  verifySignUpOtp,
  loading,
  isAuthenticated,
} = useTcbAuth()
const router = useRouter()

// 如果已登录，重定向（优先 redirect 查询参数，回退首页）
watch(isAuthenticated, (value) => {
  if (value) {
    const redirect = router.currentRoute.value.query.redirect as string
    router.push(redirect || '/')
  }
}, { immediate: true })

// 注册步骤
type Step = 'info' | 'verify'
const step = ref<Step>('info')

// 表单状态
const phone = ref('')
const otpCode = ref('')
const signUpData = ref<TcbSignUpData | null>(null)
const { remaining: countdown, isActive: countdownActive, start: startCountdown } = useCountdown()

// 区号选项（当前仅支持中国大陆）
const phoneAreaCodes = [
  { label: '+86', value: '+86', hint: '中国大陆' },
]
const phoneAreaCode = ref('+86')

// 手机号校验（根据区号匹配规则）
const phoneValid = computed(() => {
  if (phoneAreaCode.value === '+86') {
    return RE_CN_PHONE.test(phone.value)
  }
  return phone.value.length >= 6
})
const formValid = computed(() => phoneValid.value)

// 输入合法性提示（已输入但格式错误时才提示）
const phoneInvalid = computed(() => phone.value.length > 0 && !phoneValid.value)

// 验证码仅允许数字，自动剔除非数字并限制 6 位
watch(otpCode, (v) => {
  const cleaned = v.replace(/\D/g, '').slice(0, 6)
  if (cleaned !== v)
    otpCode.value = cleaned
})

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

// 返回信息填写步骤
function goBackToInfo() {
  step.value = 'info'
  otpCode.value = ''
}
</script>

<template>
  <div class="w-full space-y-6">
    <!-- 标题区域 -->
    <div class="text-center space-y-3">
      <div class="flex justify-center">
        <div class="ylf-icon-tile flex size-14 items-center justify-center rounded-2xl">
          <Icon
            name="i-lucide-user-plus"
            class="size-7"
          />
        </div>
      </div>
      <h1 class="text-2xl font-bold tracking-tight">
        注册 <span class="ylf-gradient-text">云乐坊</span>
      </h1>
      <p class="text-sm text-muted">
        {{ step === 'info' ? '使用手机号注册云乐坊账号' : `验证码已发送至 ${phoneAreaCode} ${phone}` }}
      </p>
    </div>

    <!-- 步骤 1: 填写信息 -->
    <div v-if="step === 'info'" class="space-y-4">
      <AppFormField
        label="手机号"
        name="signup-phone"
        :error="phoneInvalid ? '请输入正确的手机号' : undefined"
        hint="当前仅支持中国大陆手机号"
        required
      >
        <div class="flex gap-2">
          <AppSelect
            id="signup-phone-area"
            v-model="phoneAreaCode"
            :items="phoneAreaCodes"
            value-key="value"
            size="lg"
            class="w-24 shrink-0"
            :disabled="loading"
            aria-label="国家或地区代码"
          />
          <AppInput
            id="signup-phone"
            v-model.trim="phone"
            type="tel"
            inputmode="numeric"
            autocomplete="tel"
            maxlength="11"
            placeholder="请输入手机号"
            size="lg"
            icon="i-lucide-smartphone"
            :disabled="loading"
            class="flex-1"
            @keyup.enter="handleSignUp"
          />
        </div>
      </AppFormField>

      <AppButton
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
      <AppFormField label="验证码">
        <div class="flex gap-2">
          <AppInput
            v-model="otpCode"
            inputmode="numeric"
            autocomplete="one-time-code"
            placeholder="输入 6 位验证码"
            size="lg"
            icon="i-lucide-shield-check"
            maxlength="6"
            :disabled="loading"
            class="flex-1"
            @keyup.enter="handleVerify"
          />
          <AppButton
            :label="countdownActive ? `${countdown}s` : '重新发送'"
            color="neutral"
            variant="outline"
            size="lg"
            :disabled="countdownActive || loading"
            @click="handleResend"
          />
        </div>
      </AppFormField>

      <AppButton
        label="完成注册"
        color="primary"
        size="lg"
        block
        :loading="loading"
        :disabled="!RE_OTP.test(otpCode)"
        @click="handleVerify"
      />

      <AppButton
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
      已有云乐坊账号？<NuxtLink
        to="/login"
        class="text-primary font-medium"
      >
        立即登录
      </NuxtLink>
    </p>

    <!-- 服务条款 -->
    <p class="text-center text-xs text-dimmed">
      注册即表示您同意我们的
      <NuxtLink to="/docs/terms-of-service" class="text-primary font-medium">
        服务条款
      </NuxtLink>
      和
      <NuxtLink to="/docs/privacy-policy" class="text-primary font-medium">
        隐私政策
      </NuxtLink>
    </p>
  </div>
</template>
