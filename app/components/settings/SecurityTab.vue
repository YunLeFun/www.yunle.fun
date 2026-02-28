<script setup lang="ts">
import type { TcbBindVerificationData, TcbResetPasswordData } from '~/composables/useTcbAuth'

const {
  user,
  bindEmail,
  verifyBindEmail,
  bindGitHub,
  bindWeChat,
  unbindIdentity,
  changePassword,
  requestSetPasswordOtp,
  confirmSetPassword,
  getUserIdentities,
  loading: authLoading,
} = useTcbAuth()

// 邮箱绑定状态
const showBindEmail = ref(false)
const emailAddress = ref('')
const otpCode = ref('')
const bindData = ref<TcbBindVerificationData | null>(null)
const step = ref<'input' | 'verify'>('input')
const { remaining: countdown, isActive: countdownActive, start: startCountdown } = useCountdown()

// 解绑确认弹窗
const showUnbindConfirm = ref(false)
const unbindTarget = ref<{ provider: string, label: string } | null>(null)

// 密码管理状态
const showPasswordModal = ref(false)
const oldPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const showOldPassword = ref(false)
const showNewPassword = ref(false)
const showConfirmPassword = ref(false)

// 首次设置密码：验证码流程
const setPasswordStep = ref<'otp' | 'verify'>('otp')
const setPasswordOtpCode = ref('')
const setPasswordResetData = ref<TcbResetPasswordData | null>(null)
const { remaining: setPasswordCountdown, isActive: setPasswordCountdownActive, start: startSetPasswordCountdown } = useCountdown()

const emailValid = computed(() => /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/.test(emailAddress.value))

// 通过 getUserIdentities API 获取的真实绑定状态
const boundProviders = ref<string[]>([])

// 判断是否已绑定某个 provider（结合 providers 和 identities 双重来源）
const isGitHubBound = computed(() =>
  user.value?.providers?.includes('github') || boundProviders.value.includes('github'),
)
const isWeChatBound = computed(() =>
  user.value?.providers?.includes('wx_open') || boundProviders.value.includes('wechat'),
)

// 独立的操作 loading 状态
const githubLoading = ref(false)
const wechatLoading = ref(false)
const unbindLoading = ref(false)

// 密码表单校验
const hasPassword = computed(() => user.value?.hasPassword)
const passwordFormValid = computed(() => {
  if (hasPassword.value) {
    return oldPassword.value.length >= 6 && newPassword.value.length >= 6 && newPassword.value === confirmPassword.value
  }
  return newPassword.value.length >= 6 && newPassword.value === confirmPassword.value
})

function openBindEmail() {
  showBindEmail.value = true
  step.value = 'input'
  emailAddress.value = ''
  otpCode.value = ''
  bindData.value = null
}

async function handleSendOtp() {
  if (!emailValid.value)
    return
  try {
    bindData.value = await bindEmail(emailAddress.value)
    step.value = 'verify'
    startCountdown()
  }
  catch {
    // 错误已在 composable 中处理
  }
}

async function handleVerify() {
  if (!bindData.value || !otpCode.value)
    return
  try {
    await verifyBindEmail(bindData.value, emailAddress.value, otpCode.value)
    showBindEmail.value = false
  }
  catch {
    // 错误已在 composable 中处理
  }
}

// 刷新第三方绑定状态
async function refreshBoundProviders() {
  try {
    const identities = await getUserIdentities()
    boundProviders.value = identities
      .filter((i: any) => i.bind)
      .map((i: any) => i.id)
  }
  catch {
    // 忽略错误
  }
}

// 绑定 GitHub
async function handleBindGitHub() {
  try {
    githubLoading.value = true
    await bindGitHub()
    await refreshBoundProviders()
  }
  catch {
    // 错误已在 composable 中处理
  }
  finally {
    githubLoading.value = false
  }
}

// 绑定微信
async function handleBindWeChat() {
  try {
    wechatLoading.value = true
    await bindWeChat()
    await refreshBoundProviders()
  }
  catch {
    // 错误已在 composable 中处理
  }
  finally {
    wechatLoading.value = false
  }
}

// 解绑确认
function confirmUnbind(provider: string, label: string) {
  unbindTarget.value = { provider, label }
  showUnbindConfirm.value = true
}

async function handleUnbind() {
  if (!unbindTarget.value)
    return
  try {
    unbindLoading.value = true
    await unbindIdentity(unbindTarget.value.provider)
    await refreshBoundProviders()
    showUnbindConfirm.value = false
    unbindTarget.value = null
  }
  catch {
    // 错误已在 composable 中处理
  }
  finally {
    unbindLoading.value = false
  }
}

function openPasswordModal() {
  showPasswordModal.value = true
  oldPassword.value = ''
  newPassword.value = ''
  confirmPassword.value = ''
  showOldPassword.value = false
  showNewPassword.value = false
  showConfirmPassword.value = false
  setPasswordStep.value = 'otp'
  setPasswordOtpCode.value = ''
  setPasswordResetData.value = null
}

// 首次设置密码：发送验证码
async function handleSendSetPasswordOtp() {
  try {
    setPasswordResetData.value = await requestSetPasswordOtp()
    setPasswordStep.value = 'verify'
    startSetPasswordCountdown()
  }
  catch {
    // 错误已在 composable 中处理
  }
}

// 首次设置密码：验证并设置
async function handleConfirmSetPassword() {
  if (!setPasswordResetData.value || !setPasswordOtpCode.value || newPassword.value.length < 6 || newPassword.value !== confirmPassword.value)
    return
  try {
    await confirmSetPassword(setPasswordResetData.value, setPasswordOtpCode.value, newPassword.value)
    showPasswordModal.value = false
  }
  catch {
    // 错误已在 composable 中处理
  }
}

// 修改密码（已有密码的用户）
async function handleChangePassword() {
  if (!passwordFormValid.value)
    return
  try {
    await changePassword(oldPassword.value, newPassword.value)
    showPasswordModal.value = false
  }
  catch {
    // 错误已在 composable 中处理
  }
}

// 页面挂载时刷新第三方绑定状态（用户信息已由全局中间件获取，无需重复调用 fetchUser）
onMounted(async () => {
  await refreshBoundProviders()
})
</script>

<template>
  <div class="space-y-6">
    <UPageCard class="p-6">
      <h3 class="text-lg font-semibold mb-4">
        安全设置
      </h3>

      <div class="divide-y divide-default">
        <!-- 手机号 -->
        <div class="flex items-center justify-between py-4">
          <div class="space-y-1">
            <p class="text-sm font-medium">
              手机号
            </p>
            <p class="text-xs text-muted">
              {{ user?.phone ? `已绑定 ${user.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')}` : '未绑定手机号' }}
            </p>
          </div>
          <UBadge
            :label="user?.phone ? '已绑定' : '未绑定'"
            :color="user?.phone ? 'success' : 'warning'"
            variant="subtle"
            size="sm"
          />
        </div>

        <!-- 邮箱 -->
        <div class="flex items-center justify-between py-4">
          <div class="space-y-1">
            <p class="text-sm font-medium">
              邮箱
            </p>
            <p class="text-xs text-muted">
              {{ user?.email ? `已绑定 ${user.email}` : '未绑定邮箱，绑定后可使用邮箱登录' }}
            </p>
          </div>
          <div class="flex items-center gap-2">
            <UBadge
              :label="user?.email ? '已绑定' : '未绑定'"
              :color="user?.email ? 'success' : 'warning'"
              variant="subtle"
              size="sm"
            />
            <UButton
              :label="user?.email ? '换绑' : '绑定'"
              color="primary"
              variant="outline"
              size="xs"
              icon="i-lucide-mail"
              @click="openBindEmail"
            />
          </div>
        </div>

        <!-- 密码 -->
        <div class="flex items-center justify-between py-4">
          <div class="space-y-1">
            <p class="text-sm font-medium">
              登录密码
            </p>
            <p class="text-xs text-muted">
              {{ hasPassword ? '已设置密码，可使用邮箱/手机号 + 密码登录' : '未设置密码，设置后可使用密码登录' }}
            </p>
          </div>
          <div class="flex items-center gap-2">
            <UBadge
              :label="hasPassword ? '已设置' : '未设置'"
              :color="hasPassword ? 'success' : 'warning'"
              variant="subtle"
              size="sm"
            />
            <UButton
              :label="hasPassword ? '修改' : '设置'"
              color="primary"
              variant="outline"
              size="xs"
              icon="i-lucide-key-round"
              @click="openPasswordModal"
            />
          </div>
        </div>

        <!-- GitHub -->
        <div class="flex items-center justify-between py-4">
          <div class="flex items-center gap-3">
            <div class="size-9 flex items-center justify-center rounded-lg bg-elevated">
              <UIcon name="i-simple-icons-github" class="text-lg" />
            </div>
            <div class="space-y-1">
              <p class="text-sm font-medium">
                GitHub
              </p>
              <p class="text-xs text-muted">
                {{ isGitHubBound ? '已绑定，可使用 GitHub 登录' : '绑定后可使用 GitHub 账号登录' }}
              </p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <UBadge
              :label="isGitHubBound ? '已绑定' : '未绑定'"
              :color="isGitHubBound ? 'success' : 'warning'"
              variant="subtle"
              size="sm"
            />
            <UButton
              v-if="isGitHubBound"
              label="解绑"
              color="error"
              variant="outline"
              size="xs"
              icon="i-lucide-unlink"
              :loading="unbindLoading && unbindTarget?.provider === 'github'"
              @click="confirmUnbind('github', 'GitHub')"
            />
            <UButton
              v-else
              label="绑定"
              color="primary"
              variant="outline"
              size="xs"
              icon="i-simple-icons-github"
              :loading="githubLoading"
              @click="handleBindGitHub"
            />
          </div>
        </div>

        <!-- 微信 -->
        <div class="flex items-center justify-between py-4">
          <div class="flex items-center gap-3">
            <div class="size-9 flex items-center justify-center rounded-lg bg-elevated">
              <UIcon name="i-simple-icons-wechat" class="text-lg text-green-500" />
            </div>
            <div class="space-y-1">
              <p class="text-sm font-medium">
                微信
              </p>
              <p class="text-xs text-muted">
                {{ isWeChatBound ? '已绑定，可使用微信登录' : '绑定后可使用微信账号登录' }}
              </p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <UBadge
              :label="isWeChatBound ? '已绑定' : '未绑定'"
              :color="isWeChatBound ? 'success' : 'warning'"
              variant="subtle"
              size="sm"
            />
            <UButton
              v-if="isWeChatBound"
              label="解绑"
              color="error"
              variant="outline"
              size="xs"
              icon="i-lucide-unlink"
              :loading="unbindLoading && unbindTarget?.provider === 'wx_open'"
              @click="confirmUnbind('wx_open', '微信')"
            />
            <UButton
              v-else
              label="绑定"
              color="primary"
              variant="outline"
              size="xs"
              icon="i-simple-icons-wechat"
              :loading="wechatLoading"
              @click="handleBindWeChat"
            />
          </div>
        </div>
      </div>
    </UPageCard>

    <!-- 绑定邮箱弹窗 -->
    <UModal v-model:open="showBindEmail">
      <template #content>
        <div class="p-6 space-y-4">
          <div class="flex items-center gap-3">
            <div class="p-2 rounded-full bg-primary-50 dark:bg-primary-950">
              <UIcon name="i-lucide-mail" class="text-xl text-primary" />
            </div>
            <div>
              <h3 class="font-semibold">
                {{ user?.email ? '换绑邮箱' : '绑定邮箱' }}
              </h3>
              <p class="text-sm text-muted">
                {{ step === 'input' ? '输入邮箱地址，我们将发送验证码' : `验证码已发送至 ${emailAddress}` }}
              </p>
            </div>
          </div>

          <!-- 步骤 1: 输入邮箱 -->
          <div v-if="step === 'input'" class="space-y-4">
            <UFormField label="邮箱地址">
              <UInput
                v-model="emailAddress"
                type="email"
                placeholder="请输入邮箱地址"
                size="lg"
                icon="i-lucide-mail"
                :disabled="authLoading"
                class="w-full"
                @keyup.enter="handleSendOtp"
              />
            </UFormField>
            <div class="flex justify-end gap-3">
              <UButton
                label="取消"
                color="neutral"
                variant="outline"
                @click="showBindEmail = false"
              />
              <UButton
                label="发送验证码"
                color="primary"
                :loading="authLoading"
                :disabled="!emailValid"
                @click="handleSendOtp"
              />
            </div>
          </div>

          <!-- 步骤 2: 输入验证码 -->
          <div v-else class="space-y-4">
            <UFormField label="验证码">
              <div class="flex gap-2">
                <UInput
                  v-model="otpCode"
                  placeholder="输入 6 位验证码"
                  size="lg"
                  icon="i-lucide-shield-check"
                  maxlength="6"
                  :disabled="authLoading"
                  class="flex-1"
                  @keyup.enter="handleVerify"
                />
                <UButton
                  :label="countdownActive ? `${countdown}s` : '重新发送'"
                  color="neutral"
                  variant="outline"
                  size="lg"
                  :disabled="countdownActive || authLoading"
                  @click="handleSendOtp"
                />
              </div>
            </UFormField>
            <div class="flex justify-end gap-3">
              <UButton
                label="返回"
                color="neutral"
                variant="outline"
                @click="step = 'input'"
              />
              <UButton
                label="确认绑定"
                color="primary"
                :loading="authLoading"
                :disabled="!otpCode || otpCode.length < 4"
                @click="handleVerify"
              />
            </div>
          </div>
        </div>
      </template>
    </UModal>

    <!-- 解绑确认弹窗 -->
    <UModal v-model:open="showUnbindConfirm">
      <template #content>
        <div class="p-6 space-y-4">
          <div class="flex items-center gap-3">
            <div class="p-2 rounded-full bg-error-50 dark:bg-error-950">
              <UIcon name="i-lucide-unlink" class="text-xl text-error" />
            </div>
            <div>
              <h3 class="font-semibold">
                确认解绑
              </h3>
              <p class="text-sm text-muted">
                解绑后将无法使用 {{ unbindTarget?.label }} 账号登录，确定要继续吗？
              </p>
            </div>
          </div>
          <div class="flex justify-end gap-3">
            <UButton
              label="取消"
              color="neutral"
              variant="outline"
              @click="showUnbindConfirm = false"
            />
            <UButton
              label="确认解绑"
              color="error"
              :loading="authLoading"
              @click="handleUnbind"
            />
          </div>
        </div>
      </template>
    </UModal>

    <!-- 密码设置/修改弹窗 -->
    <UModal v-model:open="showPasswordModal">
      <template #content>
        <div class="p-6 space-y-4">
          <div class="flex items-center gap-3">
            <div class="p-2 rounded-full bg-primary-50 dark:bg-primary-950">
              <UIcon name="i-lucide-key-round" class="text-xl text-primary" />
            </div>
            <div>
              <h3 class="font-semibold">
                {{ hasPassword ? '修改密码' : '设置密码' }}
              </h3>
              <p class="text-sm text-muted">
                {{ hasPassword ? '请输入当前密码和新密码' : setPasswordStep === 'otp' ? `将发送验证码至${user?.email || user?.phone || '绑定账号'}` : '请输入验证码并设置新密码' }}
              </p>
            </div>
          </div>

          <!-- 已有密码：直接修改 -->
          <form v-if="hasPassword" class="space-y-4" @submit.prevent="handleChangePassword">
            <UFormField label="当前密码">
              <UInput
                v-model="oldPassword"
                :type="showOldPassword ? 'text' : 'password'"
                placeholder="请输入当前密码"
                size="lg"
                icon="i-lucide-lock"
                autocomplete="current-password"
                :disabled="authLoading"
                class="w-full"
                :ui="{ trailing: 'pr-10' }"
              >
                <template #trailing>
                  <UButton
                    :icon="showOldPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    :padded="false"
                    :tabindex="-1"
                    @click="showOldPassword = !showOldPassword"
                  />
                </template>
              </UInput>
            </UFormField>

            <UFormField label="新密码">
              <UInput
                v-model="newPassword"
                :type="showNewPassword ? 'text' : 'password'"
                placeholder="至少 6 位字符"
                size="lg"
                icon="i-lucide-lock"
                autocomplete="new-password"
                :disabled="authLoading"
                class="w-full"
                :ui="{ trailing: 'pr-10' }"
              >
                <template #trailing>
                  <UButton
                    :icon="showNewPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    :padded="false"
                    :tabindex="-1"
                    @click="showNewPassword = !showNewPassword"
                  />
                </template>
              </UInput>
              <template v-if="newPassword && newPassword.length < 6" #hint>
                <span class="text-xs text-error">密码长度至少 6 位</span>
              </template>
            </UFormField>

            <UFormField label="确认新密码">
              <UInput
                v-model="confirmPassword"
                :type="showConfirmPassword ? 'text' : 'password'"
                placeholder="再次输入新密码"
                size="lg"
                icon="i-lucide-lock"
                autocomplete="new-password"
                :disabled="authLoading"
                class="w-full"
                :ui="{ trailing: 'pr-10' }"
              >
                <template #trailing>
                  <UButton
                    :icon="showConfirmPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    :padded="false"
                    :tabindex="-1"
                    @click="showConfirmPassword = !showConfirmPassword"
                  />
                </template>
              </UInput>
              <template v-if="confirmPassword && newPassword !== confirmPassword" #hint>
                <span class="text-xs text-error">两次输入的密码不一致</span>
              </template>
            </UFormField>

            <div class="flex justify-end gap-3">
              <UButton
                label="取消"
                color="neutral"
                variant="outline"
                @click="showPasswordModal = false"
              />
              <UButton
                label="确认修改"
                type="submit"
                color="primary"
                :loading="authLoading"
                :disabled="!passwordFormValid"
              />
            </div>
          </form>

          <!-- 首次设置密码：步骤1 发送验证码 -->
          <div v-else-if="setPasswordStep === 'otp'" class="space-y-4">
            <p class="text-sm text-muted">
              为了验证您的身份，将向 <strong>{{ user?.email || user?.phone }}</strong> 发送验证码
            </p>
            <div class="flex justify-end gap-3">
              <UButton
                label="取消"
                color="neutral"
                variant="outline"
                @click="showPasswordModal = false"
              />
              <UButton
                label="发送验证码"
                color="primary"
                :loading="authLoading"
                :disabled="!user?.email && !user?.phone"
                @click="handleSendSetPasswordOtp"
              />
            </div>
          </div>

          <!-- 首次设置密码：步骤2 验证码 + 新密码 -->
          <form v-else class="space-y-4" @submit.prevent="handleConfirmSetPassword">
            <UFormField label="验证码">
              <div class="flex gap-2">
                <UInput
                  v-model="setPasswordOtpCode"
                  placeholder="输入 6 位验证码"
                  size="lg"
                  icon="i-lucide-shield-check"
                  maxlength="6"
                  :disabled="authLoading"
                  class="flex-1"
                />
                <UButton
                  :label="setPasswordCountdownActive ? `${setPasswordCountdown}s` : '重新发送'"
                  color="neutral"
                  variant="outline"
                  size="lg"
                  :disabled="setPasswordCountdownActive || authLoading"
                  @click="handleSendSetPasswordOtp"
                />
              </div>
            </UFormField>

            <UFormField label="新密码">
              <UInput
                v-model="newPassword"
                :type="showNewPassword ? 'text' : 'password'"
                placeholder="至少 6 位字符"
                size="lg"
                icon="i-lucide-lock"
                autocomplete="new-password"
                :disabled="authLoading"
                class="w-full"
                :ui="{ trailing: 'pr-10' }"
              >
                <template #trailing>
                  <UButton
                    :icon="showNewPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    :padded="false"
                    :tabindex="-1"
                    @click="showNewPassword = !showNewPassword"
                  />
                </template>
              </UInput>
              <template v-if="newPassword && newPassword.length < 6" #hint>
                <span class="text-xs text-error">密码长度至少 6 位</span>
              </template>
            </UFormField>

            <UFormField label="确认新密码">
              <UInput
                v-model="confirmPassword"
                :type="showConfirmPassword ? 'text' : 'password'"
                placeholder="再次输入新密码"
                size="lg"
                icon="i-lucide-lock"
                autocomplete="new-password"
                :disabled="authLoading"
                class="w-full"
                :ui="{ trailing: 'pr-10' }"
              >
                <template #trailing>
                  <UButton
                    :icon="showConfirmPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    :padded="false"
                    :tabindex="-1"
                    @click="showConfirmPassword = !showConfirmPassword"
                  />
                </template>
              </UInput>
              <template v-if="confirmPassword && newPassword !== confirmPassword" #hint>
                <span class="text-xs text-error">两次输入的密码不一致</span>
              </template>
            </UFormField>

            <div class="flex justify-end gap-3">
              <UButton
                label="返回"
                color="neutral"
                variant="outline"
                @click="setPasswordStep = 'otp'"
              />
              <UButton
                label="设置密码"
                type="submit"
                color="primary"
                :loading="authLoading"
                :disabled="!setPasswordOtpCode || setPasswordOtpCode.length < 4 || newPassword.length < 6 || newPassword !== confirmPassword"
              />
            </div>
          </form>
        </div>
      </template>
    </UModal>
  </div>
</template>
