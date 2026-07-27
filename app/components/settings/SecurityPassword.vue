<script setup lang="ts">
import type { TcbResetPasswordData } from '~/composables/useTcbAuth'
import {
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  KeyRoundIcon,
  LockKeyholeIcon,
  SendIcon,
  ShieldCheckIcon,
} from '@lucide/vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'
import { Spinner } from '@/components/ui/spinner'
import { maskPhone } from '~/utils/mask'
import SecurityCredentialRow from './SecurityCredentialRow.vue'
import SecurityOtpInput from './SecurityOtpInput.vue'
import SecurityVerificationProgress from './SecurityVerificationProgress.vue'

const RE_OTP = /^\d{6}$/

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
// 验证码发送目标：邮箱原样展示，手机号脱敏（避免在弹窗里直接暴露完整号码）
const otpTarget = computed(() =>
  user.value?.email || (user.value?.phone ? maskPhone(user.value.phone) : ''),
)
const newPasswordTooShort = computed(() => newPassword.value.length > 0 && newPassword.value.length < 6)
const confirmPasswordMismatch = computed(() =>
  confirmPasswordValue.value.length > 0 && newPassword.value !== confirmPasswordValue.value,
)
const passwordFormValid = computed(() => {
  if (hasPassword.value) {
    return oldPassword.value.length >= 6 && newPassword.value.length >= 6 && newPassword.value === confirmPasswordValue.value
  }
  return newPassword.value.length >= 6 && newPassword.value === confirmPasswordValue.value
})

watch(setPasswordOtpCode, (value) => {
  const sanitized = value.replace(/\D/g, '').slice(0, 6)
  if (sanitized !== value)
    setPasswordOtpCode.value = sanitized
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
  if (!setPasswordResetData.value || !RE_OTP.test(setPasswordOtpCode.value) || newPassword.value.length < 6 || newPassword.value !== confirmPasswordValue.value)
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
  <SecurityCredentialRow
    :icon="KeyRoundIcon"
    label="登录密码"
    :description="hasPassword ? '已设置密码，可配合邮箱或手机号登录' : '设置密码后，可在验证码之外多一种登录方式'"
    :status="hasPassword ? '已设置' : '未设置'"
    :action="hasPassword ? '修改' : '设置'"
    accent="password"
    :ready="!!hasPassword"
    @action="openModal"
  />

  <Dialog v-model:open="showModal">
    <DialogContent class="sm:max-w-lg">
      <DialogHeader>
        <div class="flex items-center gap-2 text-xs font-medium text-primary">
          <KeyRoundIcon aria-hidden="true" />
          <span>密码保护</span>
        </div>
        <DialogTitle>
          {{ hasPassword ? '修改登录密码' : '设置登录密码' }}
        </DialogTitle>
        <DialogDescription>
          {{ hasPassword ? '验证当前密码后，设置一个新的登录密码。' : '先验证已绑定的联系方式，再创建登录密码。' }}
        </DialogDescription>
      </DialogHeader>

      <!-- 已有密码：直接修改 -->
      <div v-if="hasPassword" class="px-6 pb-6">
        <form id="password-change-form" @submit.prevent="handleChangePassword">
          <FieldGroup>
            <Field>
              <FieldLabel for="password-current">
                当前密码
              </FieldLabel>
              <InputGroup :data-disabled="authLoading">
                <InputGroupAddon>
                  <LockKeyholeIcon aria-hidden="true" />
                </InputGroupAddon>
                <InputGroupInput
                  id="password-current"
                  v-model="oldPassword"
                  :type="showOldPassword ? 'text' : 'password'"
                  autocomplete="current-password"
                  placeholder="请输入当前密码"
                  :disabled="authLoading"
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    size="icon-xs"
                    :aria-label="showOldPassword ? '隐藏当前密码' : '显示当前密码'"
                    :aria-pressed="showOldPassword"
                    :disabled="authLoading"
                    @mousedown.prevent
                    @click="showOldPassword = !showOldPassword"
                  >
                    <EyeOffIcon v-if="showOldPassword" />
                    <EyeIcon v-else />
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
            </Field>

            <Field :data-invalid="newPasswordTooShort">
              <FieldLabel for="password-new">
                新密码
              </FieldLabel>
              <InputGroup :data-invalid="newPasswordTooShort" :data-disabled="authLoading">
                <InputGroupAddon>
                  <LockKeyholeIcon aria-hidden="true" />
                </InputGroupAddon>
                <InputGroupInput
                  id="password-new"
                  v-model="newPassword"
                  :type="showNewPassword ? 'text' : 'password'"
                  autocomplete="new-password"
                  placeholder="至少 6 位字符"
                  :aria-invalid="newPasswordTooShort"
                  :disabled="authLoading"
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    size="icon-xs"
                    :aria-label="showNewPassword ? '隐藏新密码' : '显示新密码'"
                    :aria-pressed="showNewPassword"
                    :disabled="authLoading"
                    @mousedown.prevent
                    @click="showNewPassword = !showNewPassword"
                  >
                    <EyeOffIcon v-if="showNewPassword" />
                    <EyeIcon v-else />
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              <FieldError v-if="newPasswordTooShort">
                密码长度至少 6 位
              </FieldError>
              <FieldDescription v-else>
                建议使用不与其他网站重复的密码
              </FieldDescription>
            </Field>

            <Field :data-invalid="confirmPasswordMismatch">
              <FieldLabel for="password-confirm">
                确认新密码
              </FieldLabel>
              <InputGroup :data-invalid="confirmPasswordMismatch" :data-disabled="authLoading">
                <InputGroupAddon>
                  <LockKeyholeIcon aria-hidden="true" />
                </InputGroupAddon>
                <InputGroupInput
                  id="password-confirm"
                  v-model="confirmPasswordValue"
                  :type="showConfirmPassword ? 'text' : 'password'"
                  autocomplete="new-password"
                  placeholder="再次输入新密码"
                  :aria-invalid="confirmPasswordMismatch"
                  :disabled="authLoading"
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    size="icon-xs"
                    :aria-label="showConfirmPassword ? '隐藏确认密码' : '显示确认密码'"
                    :aria-pressed="showConfirmPassword"
                    :disabled="authLoading"
                    @mousedown.prevent
                    @click="showConfirmPassword = !showConfirmPassword"
                  >
                    <EyeOffIcon v-if="showConfirmPassword" />
                    <EyeIcon v-else />
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              <FieldError v-if="confirmPasswordMismatch">
                两次输入的密码不一致
              </FieldError>
            </Field>
          </FieldGroup>
        </form>
      </div>

      <!-- 首次设置密码 -->
      <div v-else class="flex flex-col gap-5 px-6 pb-6">
        <SecurityVerificationProgress
          :current="setPasswordStep === 'otp' ? 1 : 2"
          first-label="验证身份"
          second-label="创建密码"
        />

        <div v-if="setPasswordStep === 'otp'">
          <Alert>
            <ShieldCheckIcon aria-hidden="true" />
            <AlertTitle>先确认是你本人</AlertTitle>
            <AlertDescription>
              验证码将发送至 <strong>{{ otpTarget || '已绑定账号' }}</strong>，验证通过后即可设置密码。
            </AlertDescription>
          </Alert>
        </div>

        <form
          v-else
          id="password-set-form"
          @submit.prevent="handleConfirmSetPassword"
        >
          <FieldGroup>
            <Field>
              <FieldLabel>验证码</FieldLabel>
              <SecurityOtpInput
                v-model="setPasswordOtpCode"
                :disabled="authLoading"
                :countdown-active="setPasswordCountdownActive"
                :countdown="setPasswordCountdown"
                @resend="handleSendSetPasswordOtp"
              />
              <FieldDescription>
                输入收到的 6 位数字验证码
              </FieldDescription>
            </Field>

            <Field :data-invalid="newPasswordTooShort">
              <FieldLabel for="password-create">
                新密码
              </FieldLabel>
              <InputGroup :data-invalid="newPasswordTooShort" :data-disabled="authLoading">
                <InputGroupAddon>
                  <LockKeyholeIcon aria-hidden="true" />
                </InputGroupAddon>
                <InputGroupInput
                  id="password-create"
                  v-model="newPassword"
                  :type="showNewPassword ? 'text' : 'password'"
                  autocomplete="new-password"
                  placeholder="至少 6 位字符"
                  :aria-invalid="newPasswordTooShort"
                  :disabled="authLoading"
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    size="icon-xs"
                    :aria-label="showNewPassword ? '隐藏新密码' : '显示新密码'"
                    :aria-pressed="showNewPassword"
                    :disabled="authLoading"
                    @mousedown.prevent
                    @click="showNewPassword = !showNewPassword"
                  >
                    <EyeOffIcon v-if="showNewPassword" />
                    <EyeIcon v-else />
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              <FieldError v-if="newPasswordTooShort">
                密码长度至少 6 位
              </FieldError>
              <FieldDescription v-else>
                建议使用不与其他网站重复的密码
              </FieldDescription>
            </Field>

            <Field :data-invalid="confirmPasswordMismatch">
              <FieldLabel for="password-create-confirm">
                确认新密码
              </FieldLabel>
              <InputGroup :data-invalid="confirmPasswordMismatch" :data-disabled="authLoading">
                <InputGroupAddon>
                  <LockKeyholeIcon aria-hidden="true" />
                </InputGroupAddon>
                <InputGroupInput
                  id="password-create-confirm"
                  v-model="confirmPasswordValue"
                  :type="showConfirmPassword ? 'text' : 'password'"
                  autocomplete="new-password"
                  placeholder="再次输入新密码"
                  :aria-invalid="confirmPasswordMismatch"
                  :disabled="authLoading"
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupButton
                    size="icon-xs"
                    :aria-label="showConfirmPassword ? '隐藏确认密码' : '显示确认密码'"
                    :aria-pressed="showConfirmPassword"
                    :disabled="authLoading"
                    @mousedown.prevent
                    @click="showConfirmPassword = !showConfirmPassword"
                  >
                    <EyeOffIcon v-if="showConfirmPassword" />
                    <EyeIcon v-else />
                  </InputGroupButton>
                </InputGroupAddon>
              </InputGroup>
              <FieldError v-if="confirmPasswordMismatch">
                两次输入的密码不一致
              </FieldError>
            </Field>
          </FieldGroup>
        </form>
      </div>

      <DialogFooter v-if="hasPassword">
        <DialogClose as-child>
          <Button type="button" variant="outline">
            取消
          </Button>
        </DialogClose>
        <Button
          type="submit"
          form="password-change-form"
          :disabled="!passwordFormValid || authLoading"
        >
          <Spinner v-if="authLoading" data-icon="inline-start" />
          <CheckIcon v-else data-icon="inline-start" />
          {{ authLoading ? '修改中' : '确认修改' }}
        </Button>
      </DialogFooter>

      <DialogFooter v-else-if="setPasswordStep === 'otp'">
        <DialogClose as-child>
          <Button type="button" variant="outline">
            取消
          </Button>
        </DialogClose>
        <Button
          type="button"
          :disabled="(!user?.email && !user?.phone) || authLoading"
          @click="handleSendSetPasswordOtp"
        >
          <Spinner v-if="authLoading" data-icon="inline-start" />
          <SendIcon v-else data-icon="inline-start" />
          {{ authLoading ? '发送中' : '发送验证码' }}
        </Button>
      </DialogFooter>

      <DialogFooter v-else>
        <Button type="button" variant="outline" @click="setPasswordStep = 'otp'">
          返回
        </Button>
        <Button
          type="submit"
          form="password-set-form"
          :disabled="!RE_OTP.test(setPasswordOtpCode) || !passwordFormValid || authLoading"
        >
          <Spinner v-if="authLoading" data-icon="inline-start" />
          <CheckIcon v-else data-icon="inline-start" />
          {{ authLoading ? '设置中' : '设置密码' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
