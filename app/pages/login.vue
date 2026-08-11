<script setup lang="ts">
import type { TcbOtpData, TcbResetPasswordData } from '~/composables/useTcbAuth'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { GITHUB_PROVIDER_ID, isOAuthProviderEnabled, WECHAT_PROVIDER_ID } from '~/utils/authProviders'
import { isAuthUsernameCompatible } from '~/utils/username'

const RE_EMAIL = /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/
const RE_CN_PHONE = /^1[3-9]\d{9}$/
const RE_OTP = /^\d{6}$/

definePageMeta({
  layout: 'auth',
})

useSeoMeta({
  title: '登录 / 注册',
  description: '登录或创建您的云乐坊账号',
})

const {
  sendPhoneOtp,
  verifyPhoneOtp,
  sendEmailOtp,
  verifyEmailOtp,
  signInWithPassword,
  resetPassword,
  confirmResetPassword,
  loginWithGitHub,
  loginWithWeChat,
  loading,
  isAuthenticated,
} = useTcbAuth()
const router = useRouter()
const toast = useAppToast()

// 如果已登录，重定向（优先 redirect 查询参数，回退首页）
watch(isAuthenticated, (value) => {
  if (value) {
    const redirect = router.currentRoute.value.query.redirect as string
    router.push(redirect || '/')
  }
}, { immediate: true })

// 登录方式切换
type LoginMode = 'phone' | 'email' | 'password'
const loginMode = shallowRef<LoginMode>('phone')

// 区号选项（当前仅支持中国大陆）
const phoneAreaCodes = [
  { label: '+86', value: '+86', hint: '中国大陆' },
]
const phoneAreaCode = ref('+86')

// 手机号登录状态
const phone = ref('')
const phoneOtpCode = ref('')
const phoneOtpData = ref<TcbOtpData | null>(null)
const phoneCodeSent = ref(false)
const { remaining: phoneCountdown, isActive: phoneCountdownActive, start: startPhoneCountdown } = useCountdown()

// 邮箱登录状态
const email = ref('')
const emailOtpCode = ref('')
const emailOtpData = ref<TcbOtpData | null>(null)
const emailCodeSent = ref(false)
const { remaining: emailCountdown, isActive: emailCountdownActive, start: startEmailCountdown } = useCountdown()

// 密码登录状态
const passwordAccount = ref('')
const password = ref('')
const showPassword = ref(false)

// 判断密码登录输入的账号类型
const isPasswordUsername = computed(() => isAuthUsernameCompatible(passwordAccount.value))

// 忘记密码状态
const showResetPassword = ref(false)
const resetAccount = ref('')
const resetOtpCode = ref('')
const resetData = ref<TcbResetPasswordData | null>(null)
const resetStep = ref<'input' | 'verify' | 'newpwd'>('input')
const newPassword = ref('')
const confirmNewPassword = ref('')
const { remaining: resetCountdown, isActive: resetCountdownActive, start: startResetCountdown } = useCountdown()

const allProviders = [
  {
    id: GITHUB_PROVIDER_ID,
    label: 'GitHub',
    icon: 'i-ri-github-fill',
    onClick: () => loginWithGitHub(),
  },
  {
    id: WECHAT_PROVIDER_ID,
    label: '微信登录',
    icon: 'i-ri-wechat-fill',
    onClick: () => loginWithWeChat(),
  },
]
// 仅展示当前线上实际可用的第三方登录（微信等未就绪的先隐藏，见 ENABLED_OAUTH_PROVIDERS）
const providers = computed(() => allProviders.filter(p => isOAuthProviderEnabled(p.id)))

// 手机号校验（根据区号匹配规则）
const phoneValid = computed(() => {
  if (phoneAreaCode.value === '+86') {
    return RE_CN_PHONE.test(phone.value)
  }
  return phone.value.length >= 6
})

// 邮箱校验
const emailValid = computed(() => RE_EMAIL.test(email.value))

// 密码登录表单校验
const isPasswordEmail = computed(() => RE_EMAIL.test(passwordAccount.value))
const isPasswordPhone = computed(() => RE_CN_PHONE.test(passwordAccount.value))
const passwordFormValid = computed(() => (isPasswordEmail.value || isPasswordPhone.value || isPasswordUsername.value) && password.value.length >= 6)

// 重置密码账号校验（邮箱或中国大陆手机号）
const resetAccountValid = computed(() => RE_EMAIL.test(resetAccount.value) || RE_CN_PHONE.test(resetAccount.value))
const newPasswordValid = computed(() => newPassword.value.length >= 6 && newPassword.value === confirmNewPassword.value)

// 输入合法性提示（用户已输入但格式不正确时才提示，避免一上来就报红）
const phoneInvalid = computed(() => phone.value.length > 0 && !phoneValid.value)
const emailInvalid = computed(() => email.value.length > 0 && !emailValid.value)

// 验证码仅允许数字，自动剔除非数字并限制 6 位
function sanitizeOtp(code: Ref<string>) {
  watch(code, (v) => {
    const cleaned = v.replace(/\D/g, '').slice(0, 6)
    if (cleaned !== v)
      code.value = cleaned
  })
}
sanitizeOtp(phoneOtpCode)
sanitizeOtp(emailOtpCode)
sanitizeOtp(resetOtpCode)

// 发送手机验证码
async function handleSendPhoneOtp() {
  if (!phoneValid.value)
    return
  try {
    phoneOtpData.value = await sendPhoneOtp(phone.value)
    phoneCodeSent.value = true
    startPhoneCountdown()
  }
  catch {
    // 错误已在 composable 中处理
  }
}

// 验证手机验证码
async function handleVerifyPhoneOtp() {
  if (!phoneOtpData.value || !phoneOtpCode.value)
    return
  try {
    await verifyPhoneOtp(phoneOtpData.value, phoneOtpCode.value)
  }
  catch {
    // 错误已在 composable 中处理
  }
}

// 发送邮箱验证码
async function handleSendEmailOtp() {
  if (!emailValid.value)
    return
  try {
    emailOtpData.value = await sendEmailOtp(email.value)
    emailCodeSent.value = true
    startEmailCountdown()
  }
  catch {
    // 错误已在 composable 中处理
  }
}

// 验证邮箱验证码
async function handleVerifyEmailOtp() {
  if (!emailOtpData.value || !emailOtpCode.value)
    return
  try {
    await verifyEmailOtp(emailOtpData.value, emailOtpCode.value)
  }
  catch {
    // 错误已在 composable 中处理
  }
}

// 密码登录
async function handlePasswordLogin() {
  if (!passwordFormValid.value)
    return
  try {
    const params: { email?: string, phone?: string, username?: string, password: string } = { password: password.value }
    if (isPasswordEmail.value) {
      params.email = passwordAccount.value
    }
    else if (isPasswordPhone.value) {
      params.phone = passwordAccount.value
    }
    else {
      params.username = passwordAccount.value
    }
    await signInWithPassword(params)
  }
  catch {
    // 错误已在 composable 中处理
  }
}

// 忘记密码 - 发送重置验证码
async function handleSendReset() {
  if (!resetAccountValid.value)
    return
  try {
    resetData.value = await resetPassword(resetAccount.value)
    resetStep.value = 'verify'
    startResetCountdown()
  }
  catch {
    // 错误已在 composable 中处理
  }
}

// 忘记密码 - 验证并设置新密码
async function handleConfirmReset() {
  if (!resetData.value || !resetOtpCode.value || !newPasswordValid.value)
    return
  try {
    await confirmResetPassword(resetData.value, resetOtpCode.value, newPassword.value)
    showResetPassword.value = false
    resetStep.value = 'input'
    resetAccount.value = ''
    resetOtpCode.value = ''
    newPassword.value = ''
    confirmNewPassword.value = ''
    resetData.value = null
    toast.add({
      title: '密码已重置',
      description: '请使用新密码登录',
      color: 'success',
    })
  }
  catch {
    // 错误已在 composable 中处理
  }
}

function openResetPassword() {
  showResetPassword.value = true
  resetStep.value = 'input'
  resetAccount.value = ''
  resetOtpCode.value = ''
  newPassword.value = ''
  confirmNewPassword.value = ''
  resetData.value = null
}

// 表单区高度平滑过渡：切换登录方式 / 展开验证码时，卡片尺寸渐变而非硬跳
const formAreaRef = ref<HTMLElement>()
const { height: formAreaHeight } = useElementSize(formAreaRef)
const morphing = ref(false)
let morphTimer: ReturnType<typeof setTimeout> | undefined
watch([loginMode, phoneCodeSent, emailCodeSent], () => {
  // 过渡期间裁剪溢出（长高时避免内容压住下方控件）；结束后恢复，避免裁掉输入框聚焦描边
  morphing.value = true
  clearTimeout(morphTimer)
  morphTimer = setTimeout(() => {
    morphing.value = false
  }, 300)
})
onUnmounted(() => clearTimeout(morphTimer))
</script>

<template>
  <div class="ylf-auth-login w-full space-y-6">
    <!-- 标题区域 -->
    <div class="text-center space-y-3">
      <div class="flex justify-center">
        <div class="ylf-gradient-tile flex h-14 w-16 items-center justify-center rounded-2xl">
          <YlfLogo
            class="h-8 w-11 text-white"
            aria-hidden="true"
          />
        </div>
      </div>
      <h1 class="ylf-dreamy-display text-3xl">
        登录或注册 <span class="ylf-gradient-text">云乐坊</span>
      </h1>
      <p class="text-sm text-muted">
        选择一种方式继续
      </p>
    </div>

    <!-- 登录方式切换 -->
    <ToggleGroup v-model="loginMode" type="single" :spacing="1" class="ylf-auth-tabs grid w-full grid-cols-3 p-1" aria-label="登录方式">
      <ToggleGroupItem value="phone" class="w-full">
        手机号
      </ToggleGroupItem>
      <ToggleGroupItem value="email" class="w-full">
        邮箱
      </ToggleGroupItem>
      <ToggleGroupItem value="password" class="w-full">
        密码登录
      </ToggleGroupItem>
    </ToggleGroup>

    <!-- 表单区：切换登录方式 / 展开验证码时平滑过渡高度，避免卡片尺寸硬跳 -->
    <div
      class="ylf-auth-morph"
      :class="{ 'ylf-auth-morph--active': morphing }"
      :style="formAreaHeight ? { height: `${formAreaHeight}px` } : undefined"
    >
      <div ref="formAreaRef">
        <!-- 手机号登录 -->
        <div v-if="loginMode === 'phone'" class="space-y-4">
          <AppFormField
            label="手机号"
            name="login-phone"
            :error="phoneInvalid ? '请输入正确的手机号' : undefined"
            hint="当前仅支持中国大陆手机号；未注册手机号验证后将自动创建账号"
          >
            <div class="flex gap-2">
              <AppSelect
                id="login-phone-area"
                v-model="phoneAreaCode"
                :items="phoneAreaCodes"
                value-key="value"
                size="lg"
                class="w-24 shrink-0"
                :disabled="loading"
                aria-label="国家或地区代码"
              />
              <AppInput
                id="login-phone"
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
                @keyup.enter="phoneCodeSent ? handleVerifyPhoneOtp() : handleSendPhoneOtp()"
              />
            </div>
          </AppFormField>

          <!-- 验证码输入 -->
          <div v-if="phoneCodeSent" class="space-y-4">
            <AppFormField label="验证码">
              <div class="flex gap-2">
                <AppInput
                  v-model="phoneOtpCode"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  placeholder="输入 6 位验证码"
                  size="lg"
                  icon="i-lucide-shield-check"
                  maxlength="6"
                  :disabled="loading"
                  class="flex-1"
                  @keyup.enter="handleVerifyPhoneOtp()"
                />
                <AppButton
                  :label="phoneCountdownActive ? `${phoneCountdown}s` : '重新发送'"
                  color="neutral"
                  variant="outline"
                  size="lg"
                  class="ylf-auth-button-secondary"
                  :disabled="phoneCountdownActive || loading"
                  @click="handleSendPhoneOtp"
                />
              </div>
            </AppFormField>

            <AppButton
              label="登录"
              color="primary"
              size="lg"
              block
              class="ylf-auth-button-primary"
              :loading="loading"
              :disabled="!RE_OTP.test(phoneOtpCode)"
              @click="handleVerifyPhoneOtp"
            />
          </div>

          <!-- 发送验证码按钮 -->
          <AppButton
            v-else
            label="获取验证码"
            color="primary"
            size="lg"
            block
            class="ylf-auth-button-primary"
            :loading="loading"
            :disabled="!phoneValid"
            @click="handleSendPhoneOtp"
          />
        </div>

        <!-- 邮箱登录 -->
        <div v-else-if="loginMode === 'email'" class="space-y-4">
          <AppFormField
            label="邮箱"
            :error="emailInvalid ? '请输入正确的邮箱地址' : undefined"
          >
            <AppInput
              v-model.trim="email"
              type="email"
              autocomplete="email"
              placeholder="请输入您的邮箱"
              size="lg"
              icon="i-lucide-mail"
              :disabled="loading"
              class="w-full"
              @keyup.enter="emailCodeSent ? handleVerifyEmailOtp() : handleSendEmailOtp()"
            />
          </AppFormField>

          <!-- 验证码输入 -->
          <div v-if="emailCodeSent" class="space-y-4">
            <AppFormField label="验证码">
              <div class="flex gap-2">
                <AppInput
                  v-model="emailOtpCode"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  placeholder="输入 6 位验证码"
                  size="lg"
                  icon="i-lucide-shield-check"
                  maxlength="6"
                  :disabled="loading"
                  class="flex-1"
                  @keyup.enter="handleVerifyEmailOtp()"
                />
                <AppButton
                  :label="emailCountdownActive ? `${emailCountdown}s` : '重新发送'"
                  color="neutral"
                  variant="outline"
                  size="lg"
                  class="ylf-auth-button-secondary"
                  :disabled="emailCountdownActive || loading"
                  @click="handleSendEmailOtp"
                />
              </div>
            </AppFormField>

            <AppButton
              label="登录"
              color="primary"
              size="lg"
              block
              class="ylf-auth-button-primary"
              :loading="loading"
              :disabled="!RE_OTP.test(emailOtpCode)"
              @click="handleVerifyEmailOtp"
            />
          </div>

          <!-- 发送验证码按钮 -->
          <AppButton
            v-else
            label="获取验证码"
            color="primary"
            size="lg"
            block
            class="ylf-auth-button-primary"
            :loading="loading"
            :disabled="!emailValid"
            @click="handleSendEmailOtp"
          />

          <p class="text-xs text-muted text-center">
            邮箱不能单独注册；请先用手机号或 GitHub 登录，并在账号设置中绑定
          </p>
        </div>

        <!-- 密码登录 -->
        <form v-else class="space-y-4" @submit.prevent="handlePasswordLogin">
          <AppFormField label="用户名、邮箱或手机号">
            <AppInput
              v-model.trim="passwordAccount"
              placeholder="请输入用户名、邮箱或手机号"
              size="lg"
              icon="i-lucide-user"
              autocomplete="username"
              :disabled="loading"
              class="w-full"
            />
          </AppFormField>

          <AppFormField label="密码">
            <AppInput
              v-model="password"
              :type="showPassword ? 'text' : 'password'"
              placeholder="请输入密码"
              size="lg"
              icon="i-lucide-key-round"
              autocomplete="current-password"
              :disabled="loading"
              class="w-full"
            >
              <template #trailing>
                <AppButton
                  :icon="showPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                  :aria-label="showPassword ? '隐藏密码' : '显示密码'"
                  :aria-pressed="showPassword"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  type="button"
                  :padded="false"
                  @click="showPassword = !showPassword"
                />
              </template>
            </AppInput>
          </AppFormField>

          <div class="flex justify-end">
            <AppButton
              label="忘记密码？"
              color="primary"
              variant="link"
              size="xs"
              type="button"
              @click="openResetPassword"
            />
          </div>

          <AppButton
            label="登录"
            type="submit"
            color="primary"
            size="lg"
            block
            class="ylf-auth-button-primary"
            :loading="loading"
            :disabled="!passwordFormValid"
          />

          <p class="text-xs text-muted text-center">
            密码登录需先在账号安全设置中设置密码
          </p>
        </form>
      </div>
    </div>

    <!-- 第三方登录（仅当有可用方式时展示，避免出现孤零零的「或」分割线） -->
    <template v-if="providers.length">
      <!-- 分割线 -->
      <div class="relative">
        <div class="absolute inset-0 flex items-center">
          <div class="w-full border-t border-default" />
        </div>
        <div class="relative flex justify-center text-sm">
          <span class="bg-default px-4 text-muted">
            或
          </span>
        </div>
      </div>

      <div class="space-y-2">
        <AppButton
          v-for="provider in providers"
          :key="provider.id"
          :label="provider.label"
          :icon="provider.icon"
          color="neutral"
          variant="subtle"
          size="lg"
          block
          class="ylf-auth-button-secondary"
          @click="provider.onClick"
        />
        <p
          v-if="providers.some(provider => provider.id === GITHUB_PROVIDER_ID)"
          class="text-center text-xs text-muted"
        >
          首次使用 GitHub 将自动创建账号
        </p>
      </div>
    </template>

    <!-- 统一登录 / 注册说明 -->
    <p class="text-center text-sm text-muted">
      无需单独注册：手机号或 GitHub 首次验证后自动创建账号
    </p>

    <!-- 服务条款 -->
    <p class="text-center text-xs text-dimmed">
      继续即表示您同意我们的
      <NuxtLink to="/docs/terms-of-service" class="text-primary font-medium">
        服务条款
      </NuxtLink>
      和
      <NuxtLink to="/docs/privacy-policy" class="text-primary font-medium">
        隐私政策
      </NuxtLink>
    </p>

    <!-- 忘记密码弹窗 -->
    <AppModal v-model:open="showResetPassword" title="重置密码">
      <template #content>
        <div class="p-6 space-y-4">
          <div class="flex items-center gap-3">
            <div class="p-2 rounded-full bg-primary-50 dark:bg-primary-950">
              <Icon name="i-lucide-key-round" class="text-xl text-primary" />
            </div>
            <div>
              <h3 class="font-semibold">
                重置密码
              </h3>
              <p class="text-sm text-muted">
                {{ resetStep === 'input' ? '输入邮箱或手机号，我们将发送验证码' : resetStep === 'verify' ? `验证码已发送至 ${resetAccount}` : '设置新密码' }}
              </p>
            </div>
          </div>

          <!-- 步骤 1: 输入邮箱 -->
          <div v-if="resetStep === 'input'" class="space-y-4">
            <AppFormField label="邮箱或手机号">
              <AppInput
                v-model.trim="resetAccount"
                autocomplete="username"
                placeholder="请输入注册时使用的邮箱或手机号"
                size="lg"
                icon="i-lucide-user"
                :disabled="loading"
                class="w-full"
                @keyup.enter="handleSendReset"
              />
            </AppFormField>
            <div class="flex justify-end gap-3">
              <AppButton
                label="取消"
                color="neutral"
                variant="outline"
                type="button"
                class="ylf-auth-button-secondary"
                @click="showResetPassword = false"
              />
              <AppButton
                label="发送验证码"
                color="primary"
                class="ylf-auth-button-primary"
                :loading="loading"
                :disabled="!resetAccountValid"
                @click="handleSendReset"
              />
            </div>
          </div>

          <!-- 步骤 2: 输入验证码 + 新密码 -->
          <form v-else-if="resetStep === 'verify'" class="space-y-4" @submit.prevent="handleConfirmReset">
            <AppFormField label="验证码">
              <div class="flex gap-2">
                <AppInput
                  v-model="resetOtpCode"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  placeholder="输入 6 位验证码"
                  size="lg"
                  icon="i-lucide-shield-check"
                  maxlength="6"
                  :disabled="loading"
                  class="flex-1"
                />
                <AppButton
                  :label="resetCountdownActive ? `${resetCountdown}s` : '重新发送'"
                  color="neutral"
                  variant="outline"
                  size="lg"
                  type="button"
                  class="ylf-auth-button-secondary"
                  :disabled="resetCountdownActive || loading"
                  @click="handleSendReset"
                />
              </div>
            </AppFormField>

            <AppFormField label="新密码">
              <AppInput
                v-model="newPassword"
                type="password"
                placeholder="至少 6 位字符"
                size="lg"
                icon="i-lucide-lock"
                autocomplete="new-password"
                :disabled="loading"
                class="w-full"
              />
            </AppFormField>

            <AppFormField
              label="确认新密码"
              :error="confirmNewPassword && newPassword !== confirmNewPassword ? '两次输入的密码不一致' : undefined"
            >
              <AppInput
                v-model="confirmNewPassword"
                type="password"
                placeholder="再次输入新密码"
                size="lg"
                icon="i-lucide-lock"
                autocomplete="new-password"
                :disabled="loading"
                class="w-full"
              />
            </AppFormField>

            <div class="flex justify-end gap-3">
              <AppButton
                label="返回"
                color="neutral"
                variant="outline"
                type="button"
                class="ylf-auth-button-secondary"
                @click="resetStep = 'input'"
              />
              <AppButton
                label="重置密码"
                type="submit"
                color="primary"
                class="ylf-auth-button-primary"
                :loading="loading"
                :disabled="!RE_OTP.test(resetOtpCode) || !newPasswordValid"
              />
            </div>
          </form>
        </div>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.ylf-auth-tabs {
  background: color-mix(in srgb, var(--ylf-surface-muted) 72%, var(--ylf-surface));
  border: 1px solid var(--ui-border-muted);
}

.ylf-auth-tab {
  min-width: 0;
  min-height: 2.5rem;
}

.ylf-auth-tab:focus-visible {
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--ui-primary) 58%, transparent),
    0 0 0 3px var(--ylf-ring);
}

.ylf-auth-login :deep(input[data-slot='base']),
.ylf-auth-login :deep(button[role='combobox'][data-slot='base']) {
  min-height: 2.625rem;
  border-radius: 0.625rem;
  background: color-mix(in srgb, var(--ylf-surface-muted) 52%, var(--ylf-surface));
  box-shadow: inset 0 0 0 1px var(--ui-border-muted);
  outline: none;
  transition:
    background-color 160ms ease,
    box-shadow 160ms ease,
    color 160ms ease;
}

.ylf-auth-login :deep(input[data-slot='base']:hover:not(:disabled)),
.ylf-auth-login :deep(button[role='combobox'][data-slot='base']:hover:not(:disabled)) {
  background: var(--ylf-surface);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ui-primary) 28%, var(--ui-border-muted));
}

.ylf-auth-login :deep(input[data-slot='base']:focus-visible),
.ylf-auth-login :deep(button[role='combobox'][data-slot='base']:focus-visible) {
  background: var(--ylf-surface);
  box-shadow:
    inset 0 0 0 1.5px color-mix(in srgb, var(--ui-primary) 88%, var(--ylf-surface)),
    0 0 0 3px var(--ylf-ring);
}

.ylf-auth-login :deep(.ylf-auth-button-primary[data-slot='base']),
.ylf-auth-login :deep(.ylf-auth-button-secondary[data-slot='base']) {
  min-height: 2.625rem;
  border-radius: 0.625rem;
  transition:
    background-color 160ms ease,
    box-shadow 160ms ease,
    color 160ms ease,
    transform 160ms ease;
}

.ylf-auth-login :deep(.ylf-auth-button-primary[data-slot='base']) {
  background: var(--ylf-gradient-brand);
  box-shadow: 0 10px 22px -12px color-mix(in srgb, #7c3aed 70%, transparent);
  color: white;
}

.ylf-auth-login :deep(.ylf-auth-button-primary[data-slot='base']:hover:not(:disabled)) {
  box-shadow: 0 12px 24px -14px var(--ui-primary);
  transform: translateY(-1px);
}

.ylf-auth-login :deep(.ylf-auth-button-primary[data-slot='base']:focus-visible) {
  outline: none;
  box-shadow:
    0 10px 22px -14px var(--ui-primary),
    0 0 0 3px var(--ylf-ring);
}

.ylf-auth-login :deep(.ylf-auth-button-primary[data-slot='base']:disabled),
.ylf-auth-login :deep(.ylf-auth-button-primary[data-slot='base'][aria-disabled='true']) {
  background: color-mix(in srgb, var(--ui-primary) 42%, var(--ylf-surface));
  box-shadow: none;
  color: color-mix(in srgb, white 82%, var(--ui-text-muted));
  opacity: 1;
  transform: none;
}

.ylf-auth-login :deep(.ylf-auth-button-secondary[data-slot='base']) {
  background: var(--ylf-surface);
  box-shadow: inset 0 0 0 1px var(--ui-border-muted);
  color: var(--ui-text);
}

.ylf-auth-login :deep(.ylf-auth-button-secondary[data-slot='base']:hover:not(:disabled)) {
  background: color-mix(in srgb, var(--ui-primary) 6%, var(--ylf-surface));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ui-primary) 24%, var(--ui-border-muted));
}

.ylf-auth-login :deep(.ylf-auth-button-secondary[data-slot='base']:focus-visible) {
  outline: none;
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--ui-primary) 52%, var(--ui-border-muted)),
    0 0 0 3px var(--ylf-ring);
}

/* 表单区高度平滑过渡：避免切换登录方式 / 展开验证码时卡片尺寸硬跳 */
.ylf-auth-morph {
  transition: height 240ms cubic-bezier(0.4, 0, 0.2, 1);
}

/* 仅过渡进行中裁剪溢出；静止时不裁剪，避免裁掉输入框聚焦描边 */
.ylf-auth-morph--active {
  overflow: hidden;
}

@media (prefers-reduced-motion: reduce) {
  .ylf-auth-morph {
    transition: none;
  }
}
</style>
