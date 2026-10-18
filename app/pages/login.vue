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
    return { prefix: '登录', highlight: ssoClient.value.name, subtitle: '使用云乐坊账号，一处登录，处处通行' }
  if (entry.value.kind === 'sso')
    return { prefix: '使用', highlight: '云乐坊账号', subtitle: '登录后将返回发起请求的应用' }
  if (entry.value.kind === 'device')
    return { prefix: '登录以授权', highlight: '桌面应用', subtitle: '登录后在下一步核对设备并授权' }
  return { prefix: '登录或注册', highlight: '云乐坊', subtitle: '选择一种方式继续' }
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
const lastLoginMode = shallowRef<LoginMode | null>(null)
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
    if (stored === 'password' || stored === 'phone' || stored === 'email')
      lastLoginMode.value = stored
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

// 航线小云：真正提交登录时起飞，登录成功后降落；只是发送验证码时不算出发
const routeState = computed(() => {
  if (isAuthenticated.value)
    return 'arrived' as const
  const submitting = loginMode.value === 'password'
    || (loginMode.value === 'phone' && phoneCodeSent.value)
    || (loginMode.value === 'email' && emailCodeSent.value)
  return loading.value && submitting ? 'flying' as const : 'idle' as const
})

// 云宝：平时看向表单；输入隐藏的密码时把视线移开，登录成功后眯眼笑
const focusedField = shallowRef<'password' | 'other' | null>(null)
function trackFocus(event: FocusEvent) {
  const target = event.target as HTMLInputElement | null
  focusedField.value = target?.autocomplete === 'current-password' || target?.autocomplete === 'new-password' ? 'password' : 'other'
}
const mascotShy = computed(() => focusedField.value === 'password' && !showPassword.value)
const mascotLook = computed(() => mascotShy.value ? { x: -1, y: -1 } : focusedField.value ? { x: -0.4, y: 1 } : { x: -0.8, y: 0.4 })

// 表单区高度平滑过渡：切换登录方式 / 展开验证码时，卡片尺寸渐变而非硬跳
const formAreaRef = useTemplateRef<HTMLElement>('formArea')
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
  <div class="ylf-auth-login relative w-full space-y-5" @focusin="trackFocus" @focusout="focusedField = null">
    <!-- 云宝：只在没有航线横幅时出现，避免和来源信息抢位置 -->
    <div
      v-if="!hasJourney"
      class="ylf-auth-mascot"
      :class="{ 'ylf-auth-mascot--shy': mascotShy }"
      aria-hidden="true"
    >
      <CuteCloud shape="round" face :mood="isAuthenticated ? 'happy' : 'calm'" :look="mascotLook" />
      <span class="ylf-auth-mascot__bubble">不偷看～</span>
    </div>

    <!-- 标题区域：其他应用跳转而来时，先说明「从哪来、回哪去」 -->
    <div class="text-center space-y-2">
      <AuthEntryBanner v-if="hasJourney" class="mb-3 sm:mb-4" :route-state="routeState" />
      <div v-else class="flex justify-center">
        <div class="ylf-auth-mark ylf-gradient-tile flex h-12 w-14 items-center justify-center rounded-2xl">
          <YlfLogo
            class="h-7 w-10 text-primary-foreground"
            aria-hidden="true"
          />
        </div>
      </div>
      <!-- 手机上横幅已说明去向，标题收小、省掉副标题，让表单留在首屏 -->
      <h1 class="font-heading font-semibold tracking-tight text-balance [overflow-wrap:anywhere] [word-break:keep-all]" :class="hasJourney ? 'text-2xl sm:text-3xl' : 'text-3xl'">
        {{ heading.prefix }} <span class="ylf-gradient-text">{{ heading.highlight }}</span>
      </h1>
      <p class="text-sm text-muted text-balance [word-break:keep-all]" :class="{ 'max-sm:hidden': hasJourney }">
        {{ heading.subtitle }}
      </p>
      <AuthEntryBanner v-if="entry.kind === 'page'" class="!mt-3" />
    </div>

    <!-- 登录方式切换 -->
    <ToggleGroup :model-value="loginMode" type="single" :spacing="1" :disabled="loading" class="ylf-auth-tabs grid w-full grid-cols-3 p-1" aria-label="登录方式" @update:model-value="selectLoginMode">
      <ToggleGroupItem value="password" class="ylf-auth-tab w-full">
        密码登录
        <span v-if="lastLoginMode === 'password'" class="ylf-auth-tab__last" title="上次使用">上次</span>
      </ToggleGroupItem>
      <ToggleGroupItem value="phone" class="ylf-auth-tab w-full">
        短信登录
        <span v-if="lastLoginMode === 'phone'" class="ylf-auth-tab__last" title="上次使用">上次</span>
      </ToggleGroupItem>
      <ToggleGroupItem value="email" class="ylf-auth-tab w-full">
        邮箱登录
        <span v-if="lastLoginMode === 'email'" class="ylf-auth-tab__last" title="上次使用">上次</span>
      </ToggleGroupItem>
    </ToggleGroup>

    <!-- 表单区：切换登录方式 / 展开验证码时平滑过渡高度，避免卡片尺寸硬跳 -->
    <div
      class="ylf-auth-morph"
      :class="{ 'ylf-auth-morph--active': morphing }"
      :style="formAreaHeight ? { height: `${formAreaHeight}px` } : undefined"
    >
      <div ref="formArea" class="ylf-auth-form-stage">
        <Transition name="ylf-auth-form">
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
              :label="submitLabel"
              type="submit"
              color="primary"
              size="lg"
              block
              :loading="loading"
              :disabled="!passwordFormValid"
            />

            <p class="text-xs text-muted text-center">
              还没有账号或未设置密码？
              <AppButton
                label="短信登录 / 注册"
                color="primary"
                variant="link"
                size="xs"
                type="button"
                :disabled="loading"
                @click="loginMode = 'phone'"
              />
            </p>
          </form>
        </Transition>
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

      <div class="grid gap-2">
        <AppButton
          v-for="provider in providers"
          :key="provider.id"
          :label="provider.label"
          :icon="provider.icon"
          color="neutral"
          variant="subtle"
          size="lg"
          block
          @click="provider.onClick"
        />
      </div>
    </template>

    <!-- 统一登录 / 注册说明 -->
    <p class="text-center text-xs leading-5 text-muted sm:whitespace-nowrap">
      手机号或 GitHub 首次验证后自动创建账号
    </p>

    <!-- 服务条款 -->
    <p class="text-center text-xs leading-5 text-dimmed">
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
  background: color-mix(in srgb, var(--ylf-surface-muted) 72%, var(--ylf-surface));
  border: 1px solid var(--ui-border-muted);
  border-radius: 0.875rem;
  box-shadow: inset 0 1px 2px color-mix(in srgb, var(--ui-text) 5%, transparent);
}

.ylf-auth-tab {
  min-width: 0;
  min-height: 2.5rem;
  border: 1px solid transparent;
  transition:
    background-color 180ms ease,
    border-color 180ms ease,
    box-shadow 180ms ease,
    color 180ms ease,
    transform 180ms ease;
}

.ylf-auth-tab[data-state='on'] {
  border-color: color-mix(in srgb, var(--ui-primary) 22%, var(--ylf-glass-highlight));
  background: color-mix(in srgb, var(--ylf-surface) 94%, var(--ui-primary));
  box-shadow:
    0 1px 0 color-mix(in srgb, var(--ylf-glass-highlight) 86%, transparent) inset,
    0 8px 18px -14px color-mix(in srgb, var(--ui-primary) 82%, transparent);
  transform: translateY(-1px);
}

.ylf-auth-tab:focus-visible {
  box-shadow:
    inset 0 0 0 1px color-mix(in srgb, var(--ui-primary) 58%, transparent),
    0 0 0 3px var(--ylf-ring);
}

.ylf-auth-mark {
  position: relative;
  box-shadow:
    0 1px 0 color-mix(in srgb, var(--ylf-glass-highlight) 56%, transparent) inset,
    0 16px 30px -18px color-mix(in srgb, var(--ui-primary) 78%, transparent);
}

.ylf-auth-mark::after {
  position: absolute;
  border: 1px solid color-mix(in srgb, var(--ylf-glass-highlight) 52%, transparent);
  border-radius: inherit;
  content: '';
  inset: 1px;
  pointer-events: none;
}

/* 「上次」角标：只标记上次成功的方式，不代替选中态 */
.ylf-auth-tab__last {
  margin-left: 0.25rem;
  padding: 0 0.3125rem;
  border-radius: 9999px;
  background: color-mix(in srgb, var(--ui-primary) 12%, transparent);
  color: var(--ui-primary);
  font-size: 0.625rem;
  font-weight: 600;
  line-height: 1rem;
}

/* 云宝：坐在卡片右上角，轻轻浮动；害羞时侧过身并冒出气泡 */
.ylf-auth-mascot {
  position: absolute;
  z-index: 2;
  top: -0.25rem;
  right: -0.25rem;
  width: 5.25rem;
  filter: drop-shadow(0 6px 10px color-mix(in srgb, var(--ylf-sso-sky) 45%, transparent))
    drop-shadow(0 1px 1px color-mix(in srgb, var(--ylf-sso-cloud-border) 55%, transparent));
  animation: ylf-auth-mascot-float 5s ease-in-out infinite;
  pointer-events: none;
  transition: rotate var(--ylf-duration-normal, 220ms) var(--ylf-ease-standard, ease);
}

.ylf-auth-mascot--shy {
  rotate: -8deg;
}

.ylf-auth-mascot__bubble {
  position: absolute;
  top: -0.25rem;
  right: 4.25rem;
  padding: 0.125rem 0.5rem;
  border: 1px solid var(--ui-border-muted);
  border-radius: 9999px 9999px 0.25rem 9999px;
  background: var(--ylf-surface);
  color: var(--ui-text-muted);
  font-size: 0.625rem;
  opacity: 0;
  scale: 0.85;
  transform-origin: bottom right;
  transition:
    opacity 160ms ease,
    scale 200ms cubic-bezier(0.34, 1.56, 0.64, 1);
  white-space: nowrap;
}

.ylf-auth-mascot--shy .ylf-auth-mascot__bubble {
  opacity: 1;
  scale: 1;
}

@keyframes ylf-auth-mascot-float {
  0%,
  100% {
    translate: 0 0;
  }
  50% {
    translate: 0 -3px;
  }
}

/* 表单区高度平滑过渡：避免切换登录方式 / 展开验证码时卡片尺寸硬跳 */
.ylf-auth-morph {
  transition: height 240ms cubic-bezier(0.4, 0, 0.2, 1);
}

.ylf-auth-form-stage {
  position: relative;
}

/* 登录方式切换：轻微位移与淡入淡出，避免卡片内容硬切。 */
.ylf-auth-form-enter-active,
.ylf-auth-form-leave-active {
  transition:
    opacity 160ms ease,
    transform 200ms cubic-bezier(0.22, 1, 0.36, 1);
  transform-origin: top center;
}

.ylf-auth-form-leave-active {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  pointer-events: none;
}

.ylf-auth-form-enter-from {
  opacity: 0;
  transform: translate3d(0, 6px, 0);
}

.ylf-auth-form-leave-to {
  opacity: 0;
  transform: translate3d(0, -3px, 0);
}

/* 仅过渡进行中裁剪溢出；静止时不裁剪，避免裁掉输入框聚焦描边 */
.ylf-auth-morph--active {
  overflow: hidden;
}

@media (prefers-reduced-motion: reduce) {
  .ylf-auth-morph,
  .ylf-auth-form-enter-active,
  .ylf-auth-form-leave-active,
  .ylf-auth-tab {
    transition: none;
  }

  .ylf-auth-mascot {
    animation: none;
  }

  .ylf-auth-tab[data-state='on'] {
    transform: none;
  }
}
</style>
