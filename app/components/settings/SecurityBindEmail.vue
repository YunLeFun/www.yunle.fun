<script setup lang="ts">
import type { TcbBindVerificationData } from '~/composables/useTcbAuth'
import { CheckIcon, MailIcon, SendIcon } from '@lucide/vue'
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
  InputGroupInput,
} from '@/components/ui/input-group'
import { Spinner } from '@/components/ui/spinner'
import { EmailBindingError } from '~/composables/auth/types'
import SecurityCredentialRow from './SecurityCredentialRow.vue'
import SecurityOtpInput from './SecurityOtpInput.vue'
import SecurityVerificationProgress from './SecurityVerificationProgress.vue'

const RE_EMAIL = /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/
const RE_OTP = /^\d{6}$/

const {
  user,
  bindEmail,
  verifyBindEmail,
  loading: authLoading,
} = useTcbAuth()

const showModal = shallowRef(false)
const emailAddress = shallowRef('')
const otpCode = shallowRef('')
const bindData = shallowRef<TcbBindVerificationData | null>(null)
const step = shallowRef<'input' | 'verify'>('input')
const emailFieldError = shallowRef('')
const otpFieldError = shallowRef('')
const { remaining: countdown, isActive: countdownActive, start: startCountdown } = useCountdown()

const normalizedEmail = computed(() => emailAddress.value.trim().toLowerCase())
const emailValid = computed(() => RE_EMAIL.test(normalizedEmail.value))
const emailInvalid = computed(() => emailAddress.value.length > 0 && !emailValid.value)
const emailError = computed(() => emailFieldError.value || (emailInvalid.value ? '请输入正确的邮箱地址' : ''))
const emailHasError = computed(() => emailError.value.length > 0)

watch(otpCode, (value) => {
  otpFieldError.value = ''
  const sanitized = value.replace(/\D/g, '').slice(0, 6)
  if (sanitized !== value)
    otpCode.value = sanitized
})

watch(emailAddress, () => {
  emailFieldError.value = ''
})

function openModal() {
  showModal.value = true
  step.value = 'input'
  emailAddress.value = ''
  otpCode.value = ''
  bindData.value = null
  emailFieldError.value = ''
  otpFieldError.value = ''
}

async function handleSendOtp() {
  emailFieldError.value = ''
  if (!emailValid.value) {
    emailFieldError.value = normalizedEmail.value ? '请输入正确的邮箱地址' : '请输入邮箱地址'
    return
  }
  if (normalizedEmail.value === user.value?.email?.trim().toLowerCase()) {
    emailFieldError.value = '该邮箱已绑定当前账号'
    return
  }

  emailAddress.value = normalizedEmail.value
  try {
    bindData.value = await bindEmail(normalizedEmail.value)
    otpCode.value = ''
    otpFieldError.value = ''
    step.value = 'verify'
    startCountdown()
  }
  catch (err: unknown) {
    if (!(err instanceof EmailBindingError))
      return
    if (err.presentation.field === 'email') {
      emailFieldError.value = err.presentation.description
      step.value = 'input'
    }
  }
}

async function handleVerify() {
  if (!bindData.value || !RE_OTP.test(otpCode.value))
    return
  otpFieldError.value = ''
  try {
    await verifyBindEmail(bindData.value, normalizedEmail.value, otpCode.value)
    showModal.value = false
  }
  catch (err: unknown) {
    if (!(err instanceof EmailBindingError))
      return
    if (err.presentation.field === 'otp') {
      otpFieldError.value = err.presentation.description
    }
    else if (err.presentation.field === 'email') {
      emailFieldError.value = err.presentation.description
      step.value = 'input'
    }
  }
}
</script>

<template>
  <SecurityCredentialRow
    :icon="MailIcon"
    label="邮箱"
    :description="user?.email ? `已绑定 ${user.email}` : '绑定后可使用邮箱验证码登录，也能用于找回账号'"
    :status="user?.email ? '已绑定' : '未绑定'"
    :action="user?.email ? '换绑' : '绑定'"
    accent="mail"
    :ready="!!user?.email"
    @action="openModal"
  />

  <Dialog v-model:open="showModal">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <div class="flex items-center gap-2 text-xs font-medium text-primary">
          <MailIcon aria-hidden="true" />
          <span>邮箱验证</span>
        </div>
        <DialogTitle>
          {{ user?.email ? '换绑邮箱' : '绑定邮箱' }}
        </DialogTitle>
        <DialogDescription aria-live="polite">
          {{ step === 'input' ? '输入常用邮箱，我们会发送一封验证码邮件。' : `验证码已发送至 ${emailAddress}` }}
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-5 px-6 pb-6">
        <SecurityVerificationProgress
          :current="step === 'input' ? 1 : 2"
          first-label="确认邮箱"
          second-label="验证邮件"
        />

        <form
          v-if="step === 'input'"
          id="email-bind-form"
          @submit.prevent="handleSendOtp"
        >
          <FieldGroup>
            <Field :data-invalid="emailHasError">
              <FieldLabel for="email-bind-address">
                邮箱地址
              </FieldLabel>
              <InputGroup :data-invalid="emailHasError" :data-disabled="authLoading">
                <InputGroupAddon>
                  <MailIcon aria-hidden="true" />
                </InputGroupAddon>
                <InputGroupInput
                  id="email-bind-address"
                  v-model="emailAddress"
                  type="email"
                  autocomplete="email"
                  placeholder="name@example.com"
                  :aria-invalid="emailHasError || undefined"
                  :aria-describedby="emailHasError ? 'email-bind-address-error' : 'email-bind-address-hint'"
                  :disabled="authLoading"
                />
              </InputGroup>
              <FieldError v-if="emailHasError" id="email-bind-address-error">
                {{ emailError }}
              </FieldError>
              <FieldDescription v-else id="email-bind-address-hint">
                建议使用长期可访问的常用邮箱
              </FieldDescription>
            </Field>
          </FieldGroup>
        </form>

        <form
          v-else
          id="email-verify-form"
          @submit.prevent="handleVerify"
        >
          <FieldGroup>
            <Field :data-invalid="!!otpFieldError">
              <FieldLabel>邮箱验证码</FieldLabel>
              <SecurityOtpInput
                v-model="otpCode"
                :disabled="authLoading"
                :invalid="!!otpFieldError"
                :aria-describedby="otpFieldError ? 'email-bind-otp-error' : 'email-bind-otp-hint'"
                :countdown-active="countdownActive"
                :countdown="countdown"
                test-id="email-bind-otp"
                @resend="handleSendOtp"
              />
              <FieldError v-if="otpFieldError" id="email-bind-otp-error">
                {{ otpFieldError }}
              </FieldError>
              <FieldDescription v-else id="email-bind-otp-hint">
                输入邮件中的 6 位数字验证码
              </FieldDescription>
            </Field>
          </FieldGroup>
        </form>
      </div>

      <DialogFooter v-if="step === 'input'">
        <DialogClose as-child>
          <Button type="button" variant="outline">
            取消
          </Button>
        </DialogClose>
        <Button
          type="submit"
          form="email-bind-form"
          :disabled="!emailValid || !!emailFieldError || authLoading"
        >
          <Spinner v-if="authLoading" data-icon="inline-start" />
          <SendIcon v-else data-icon="inline-start" />
          {{ authLoading ? '发送中' : '发送验证码' }}
        </Button>
      </DialogFooter>

      <DialogFooter v-else>
        <Button type="button" variant="outline" @click="step = 'input'">
          返回修改
        </Button>
        <Button
          type="submit"
          form="email-verify-form"
          :disabled="!RE_OTP.test(otpCode) || !!otpFieldError || authLoading"
        >
          <Spinner v-if="authLoading" data-icon="inline-start" />
          <CheckIcon v-else data-icon="inline-start" />
          {{ authLoading ? '验证中' : '确认绑定' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
