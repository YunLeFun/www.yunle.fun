<script setup lang="ts">
import type { SignInWithPasswordCredentials } from '@cloudbase/js-sdk/auth'
import type { TcbOtpData, TcbResetPasswordData } from '~/composables/useTcbAuth'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { GITHUB_PROVIDER_ID, isOAuthProviderEnabled, WECHAT_PROVIDER_ID } from '~/utils/authProviders'
import { getSafeLoginRedirect } from '~/utils/authRoutes'
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
const { entry, ssoClient } = useAuthEntry()

// 来路决定标题：SSO 写明要登录的应用，设备授权写明下一步，其余保持「登录或注册云乐坊」
const heading = computed(() => {
  if (entry.value.kind === 'sso' && ssoClient.value)
    return { prefix: '登录', highlight: ssoClient.value.name, subtitle: '使用你的云乐坊账号继续' }
  if (entry.value.kind === 'sso')
    return { prefix: '使用', highlight: '云乐坊账号', subtitle: '登录后将返回发起请求的应用' }
  if (entry.value.kind === 'device')
    return { prefix: '登录以授权', highlight: '桌面应用', subtitle: '登录后在下一步核对设备并授权' }
  return { prefix: '登录', highlight: '云乐坊', subtitle: '' }
})
const hasJourney = computed(() => entry.value.kind === 'sso' || entry.value.kind === 'device')
const submitLabel = computed(() => entry.value.kind === 'direct' ? '登录' : '登录并继续')

// 如果已登录，重定向（优先 redirect 查询参数，回退首页）
watch(isAuthenticated, (value) => {
  if (value) {
    const redirect = getSafeLoginRedirect(router.currentRoute.value.query.redirect)
    router.replace(redirect)
  }
}, { immediate: true })

// 登录方式切换
type LoginMode = 'phone' | 'email' | 'password'
const loginMode = shallowRef<LoginMode>('password')
const loginModeStorageKey = 'ylf:last-successful-login-mode'

function selectLoginMode(value: unknown) {
  // 单选项再次点击时会发出空值，保持当前表单和选中状态一致。
  if (value === 'password' || value === 'phone' || value === 'email')
    loginMode.value = value
}

onMounted(() => {
  try {
    const stored = localStorage.getItem(loginModeStorageKey)
    selectLoginMode(stored)
  }
  catch {
    // 浏览器禁用存储时，继续使用默认登录方式。
  }
})

function rememberLoginMode(mode: LoginMode) {
  try {
    localStorage.setItem(loginModeStorageKey, mode)
  }
  catch {
    // 偏好保存失败不影响登录，只记录方式，不保存账号或凭据。
  }
}

// 区号选项（当前仅支持中国大陆）
const phoneAreaCodes = [
  { label: '+86', value: '+86', hint: '中国大陆' },
]
const phoneAreaCode = ref('+86')

// 手机号登录状态
const phone = ref('')
const phoneOtpCode = ref('')
const phoneOtpData = shallowRef<TcbOtpData | null>(null)
const phoneCodeSent = ref(false)
const { remaining: phoneCountdown, isActive: phoneCountdownActive, start: startPhoneCountdown } = useCountdown()

// 邮箱登录状态
const email = ref('')
const emailOtpCode = ref('')
const emailOtpData = shallowRef<TcbOtpData | null>(null)
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
const resetData = shallowRef<TcbResetPasswordData | null>(null)
const resetStep = ref<'input' | 'verify' | 'newpwd'>('input')
const newPassword = ref('')
const confirmNewPassword = ref('')
const { remaining: resetCountdown, isActive: resetCountdownActive, start: startResetCountdown } = useCountdown()

const allProviders = [
  {
    id: GITHUB_PROVIDER_ID,
    label: '使用 GitHub 继续',
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
    rememberLoginMode('phone')
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
    rememberLoginMode('email')
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
    let params: SignInWithPasswordCredentials
    if (isPasswordEmail.value) {
      params = { email: passwordAccount.value, password: password.value }
    }
    else if (isPasswordPhone.value) {
      params = { phone: passwordAccount.value, password: password.value }
    }
    else {
      params = { username: passwordAccount.value, password: password.value }
    }
    await signInWithPassword(params)
    rememberLoginMode('password')
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
</script>

<template>
  <div class="ylf-auth-login w-full space-y-5">
    <div class="space-y-2">
      <h1 class="ylf-title [overflow-wrap:anywhere]">
        {{ heading.prefix }} {{ heading.highlight }}
      </h1>
      <p v-if="hasJourney" class="text-sm leading-6 text-muted">
        {{ heading.subtitle }}
      </p>
      <AuthEntryBanner v-if="entry.kind !== 'direct'" />
    </div>

    <!-- 登录方式切换 -->
    <ToggleGroup :model-value="loginMode" type="single" :spacing="1" :disabled="loading" class="ylf-auth-tabs grid w-full grid-cols-3 rounded-[var(--ylf-radius)] p-[3px]" aria-label="登录方式" @update:model-value="selectLoginMode">
      <ToggleGroupItem value="password" class="ylf-auth-tab min-h-11 w-full min-w-0 rounded-[var(--ylf-radius-sm)]">
        密码登录
      </ToggleGroupItem>
      <ToggleGroupItem value="phone" class="ylf-auth-tab min-h-11 w-full min-w-0 rounded-[var(--ylf-radius-sm)]">
        短信登录
      </ToggleGroupItem>
      <ToggleGroupItem value="email" class="ylf-auth-tab min-h-11 w-full min-w-0 rounded-[var(--ylf-radius-sm)]">
        邮箱登录
      </ToggleGroupItem>
    </ToggleGroup>

    <!-- 直接切换表单，避免旧表单在过渡期间继续占位或接收焦点。 -->
    <div>
      <!-- 手机号登录 -->
      <div
        v-if="loginMode === 'phone'"
        :key="phoneCodeSent ? 'phone-code' : 'phone-account'"
        class="space-y-4"
      >
        <AppFormField
          label="手机号"
          name="login-phone"
          :error="phoneInvalid ? '请输入正确的手机号' : undefined"
          hint="仅支持中国大陆手机号，首次验证自动创建账号"
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
                :disabled="phoneCountdownActive || loading"
                @click="handleSendPhoneOtp"
              />
            </div>
          </AppFormField>

          <AppButton
            :label="submitLabel"
            color="primary"
            size="lg"
            block
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
          :loading="loading"
          :disabled="!phoneValid"
          @click="handleSendPhoneOtp"
        />
      </div>

      <!-- 邮箱登录 -->
      <div
        v-else-if="loginMode === 'email'"
        :key="emailCodeSent ? 'email-code' : 'email-account'"
        class="space-y-4"
      >
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
                :disabled="emailCountdownActive || loading"
                @click="handleSendEmailOtp"
              />
            </div>
          </AppFormField>

          <AppButton
            :label="submitLabel"
            color="primary"
            size="lg"
            block
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
          :loading="loading"
          :disabled="!emailValid"
          @click="handleSendEmailOtp"
        />

        <p class="text-xs text-muted text-center">
          邮箱仅用于已绑定账号登录。
          <NuxtLink to="/docs/getting-started/account" class="text-primary font-medium">
            了解注册方式
          </NuxtLink>
        </p>
      </div>

      <!-- 密码登录 -->
      <form v-else key="password" class="space-y-4" @submit.prevent="handlePasswordLogin">
        <AppFormField label="用户名、邮箱或手机号" name="login-username">
          <AppInput
            v-model.trim="passwordAccount"
            name="username"
            autocapitalize="none"
            :spellcheck="false"
            placeholder="请输入用户名、邮箱或手机号"
            size="lg"
            icon="i-lucide-user"
            autocomplete="username"
            :disabled="loading"
            class="w-full"
          />
        </AppFormField>

        <AppFormField label="密码" name="login-password">
          <AppInput
            v-model="password"
            name="password"
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

        <div class="flex items-center justify-between">
          <AppButton
            label="短信注册"
            color="primary"
            variant="link"
            size="xs"
            :disabled="loading"
            @click="loginMode = 'phone'"
          />
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
          :label="submitLabel"
          type="submit"
          color="primary"
          size="lg"
          block
          :loading="loading"
          :disabled="!passwordFormValid"
        />
      </form>
    </div>

    <!-- 第三方登录（仅当有可用方式时展示，避免出现孤零零的「或」分割线） -->
    <template v-if="providers.length">
      <!-- 分割线 -->
      <div class="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 text-xs text-muted">
        <AppSeparator />
        <span>或</span>
        <AppSeparator />
      </div>

      <div class="grid gap-2">
        <AppButton
          v-for="provider in providers"
          :key="provider.id"
          :label="provider.label"
          :icon="provider.icon"
          color="neutral"
          variant="outline"
          size="lg"
          block
          :disabled="loading"
          @click="provider.onClick"
        />
      </div>
    </template>

    <!-- 注册说明与条款共用一组次要文字。 -->
    <p class="text-center text-xs leading-5 text-dimmed">
      <span class="block">短信或 GitHub 首次登录将自动注册。</span>
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
                @click="showResetPassword = false"
              />
              <AppButton
                label="发送验证码"
                color="primary"
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
                @click="resetStep = 'input'"
              />
              <AppButton
                label="重置密码"
                type="submit"
                color="primary"
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
  border: 1px solid var(--ylf-c-border);
  border-radius: var(--ylf-radius);
  background: var(--ylf-c-bg-soft);
}

/* Reka 的项不携带页面 scope 属性，从分组向内定位选中状态。 */
.ylf-auth-tabs :deep(.ylf-auth-tab[data-state='on']) {
  background: var(--ylf-c-surface);
  color: var(--ylf-c-brand);
}
</style>
