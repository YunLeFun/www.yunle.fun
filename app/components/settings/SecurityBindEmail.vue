<script setup lang="ts">
import type { TcbBindVerificationData } from '~/composables/useTcbAuth'

const RE_EMAIL = /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/

const {
  user,
  bindEmail,
  verifyBindEmail,
  loading: authLoading,
} = useTcbAuth()

const showModal = ref(false)
const emailAddress = ref('')
const otpCode = ref('')
const bindData = ref<TcbBindVerificationData | null>(null)
const step = ref<'input' | 'verify'>('input')
const { remaining: countdown, isActive: countdownActive, start: startCountdown } = useCountdown()

const emailValid = computed(() => RE_EMAIL.test(emailAddress.value))

function openModal() {
  showModal.value = true
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
    showModal.value = false
  }
  catch {
    // 错误已在 composable 中处理
  }
}
</script>

<template>
  <!-- 邮箱行 -->
  <div class="flex items-center justify-between gap-3 py-4">
    <div class="min-w-0 flex-1 space-y-1">
      <p class="text-sm font-medium">
        邮箱
      </p>
      <p class="truncate text-xs text-muted">
        {{ user?.email ? `已绑定 ${user.email}` : '未绑定邮箱，绑定后可使用邮箱登录' }}
      </p>
    </div>
    <div class="flex shrink-0 items-center gap-2">
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
        @click="openModal"
      />
    </div>
  </div>

  <!-- 绑定邮箱弹窗 -->
  <UModal v-model:open="showModal">
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
              @click="showModal = false"
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
</template>
