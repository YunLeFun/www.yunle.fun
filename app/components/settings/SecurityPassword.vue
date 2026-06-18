<script setup lang="ts">
import type { TcbResetPasswordData } from '~/composables/useTcbAuth'

const {
  user,
  changePassword,
  requestSetPasswordOtp,
  confirmSetPassword,
  loading: authLoading,
} = useTcbAuth()

const showModal = ref(false)
const oldPassword = ref('')
const newPassword = ref('')
const confirmPasswordValue = ref('')
const showOldPassword = ref(false)
const showNewPassword = ref(false)
const showConfirmPassword = ref(false)

// 首次设置密码：验证码流程
const setPasswordStep = ref<'otp' | 'verify'>('otp')
const setPasswordOtpCode = ref('')
const setPasswordResetData = ref<TcbResetPasswordData | null>(null)
const { remaining: setPasswordCountdown, isActive: setPasswordCountdownActive, start: startSetPasswordCountdown } = useCountdown()

const hasPassword = computed(() => user.value?.hasPassword)
const passwordFormValid = computed(() => {
  if (hasPassword.value) {
    return oldPassword.value.length >= 6 && newPassword.value.length >= 6 && newPassword.value === confirmPasswordValue.value
  }
  return newPassword.value.length >= 6 && newPassword.value === confirmPasswordValue.value
})

function openModal() {
  showModal.value = true
  oldPassword.value = ''
  newPassword.value = ''
  confirmPasswordValue.value = ''
  showOldPassword.value = false
  showNewPassword.value = false
  showConfirmPassword.value = false
  setPasswordStep.value = 'otp'
  setPasswordOtpCode.value = ''
  setPasswordResetData.value = null
}

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

async function handleConfirmSetPassword() {
  if (!setPasswordResetData.value || !setPasswordOtpCode.value || newPassword.value.length < 6 || newPassword.value !== confirmPasswordValue.value)
    return
  try {
    await confirmSetPassword(setPasswordResetData.value, setPasswordOtpCode.value, newPassword.value)
    showModal.value = false
  }
  catch {
    // 错误已在 composable 中处理
  }
}

async function handleChangePassword() {
  if (!passwordFormValid.value)
    return
  try {
    await changePassword(oldPassword.value, newPassword.value)
    showModal.value = false
  }
  catch {
    // 错误已在 composable 中处理
  }
}
</script>

<template>
  <!-- 密码行 -->
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
        @click="openModal"
      />
    </div>
  </div>

  <!-- 密码设置/修改弹窗 -->
  <UModal v-model:open="showModal">
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
            >
              <template #trailing>
                <UButton
                  :icon="showOldPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  type="button"
                  :padded="false"
                  :aria-label="showOldPassword ? '隐藏当前密码' : '显示当前密码'"
                  :aria-pressed="showOldPassword"
                  :disabled="authLoading"
                  @mousedown.prevent
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
            >
              <template #trailing>
                <UButton
                  :icon="showNewPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  type="button"
                  :padded="false"
                  :aria-label="showNewPassword ? '隐藏新密码' : '显示新密码'"
                  :aria-pressed="showNewPassword"
                  :disabled="authLoading"
                  @mousedown.prevent
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
              v-model="confirmPasswordValue"
              :type="showConfirmPassword ? 'text' : 'password'"
              placeholder="再次输入新密码"
              size="lg"
              icon="i-lucide-lock"
              autocomplete="new-password"
              :disabled="authLoading"
              class="w-full"
            >
              <template #trailing>
                <UButton
                  :icon="showConfirmPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  type="button"
                  :padded="false"
                  :aria-label="showConfirmPassword ? '隐藏确认密码' : '显示确认密码'"
                  :aria-pressed="showConfirmPassword"
                  :disabled="authLoading"
                  @mousedown.prevent
                  @click="showConfirmPassword = !showConfirmPassword"
                />
              </template>
            </UInput>
            <template v-if="confirmPasswordValue && newPassword !== confirmPasswordValue" #hint>
              <span class="text-xs text-error">两次输入的密码不一致</span>
            </template>
          </UFormField>

          <div class="flex justify-end gap-3">
            <UButton
              label="取消"
              color="neutral"
              variant="outline"
              @click="showModal = false"
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
              @click="showModal = false"
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
            >
              <template #trailing>
                <UButton
                  :icon="showNewPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  type="button"
                  :padded="false"
                  :aria-label="showNewPassword ? '隐藏新密码' : '显示新密码'"
                  :aria-pressed="showNewPassword"
                  :disabled="authLoading"
                  @mousedown.prevent
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
              v-model="confirmPasswordValue"
              :type="showConfirmPassword ? 'text' : 'password'"
              placeholder="再次输入新密码"
              size="lg"
              icon="i-lucide-lock"
              autocomplete="new-password"
              :disabled="authLoading"
              class="w-full"
            >
              <template #trailing>
                <UButton
                  :icon="showConfirmPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  type="button"
                  :padded="false"
                  :aria-label="showConfirmPassword ? '隐藏确认密码' : '显示确认密码'"
                  :aria-pressed="showConfirmPassword"
                  :disabled="authLoading"
                  @mousedown.prevent
                  @click="showConfirmPassword = !showConfirmPassword"
                />
              </template>
            </UInput>
            <template v-if="confirmPasswordValue && newPassword !== confirmPasswordValue" #hint>
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
              :disabled="!setPasswordOtpCode || setPasswordOtpCode.length < 4 || newPassword.length < 6 || newPassword !== confirmPasswordValue"
            />
          </div>
        </form>
      </div>
    </template>
  </UModal>
</template>
