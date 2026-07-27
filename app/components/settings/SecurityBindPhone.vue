<script setup lang="ts">
import type { TcbBindVerificationData } from '~/composables/useTcbAuth'
import { CheckIcon, SendIcon, SmartphoneIcon } from '@lucide/vue'
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
  InputGroupText,
} from '@/components/ui/input-group'
import { Spinner } from '@/components/ui/spinner'
import { maskPhone } from '~/utils/mask'
import SecurityCredentialRow from './SecurityCredentialRow.vue'
import SecurityOtpInput from './SecurityOtpInput.vue'
import SecurityVerificationProgress from './SecurityVerificationProgress.vue'

const RE_CN_PHONE = /^1[3-9]\d{9}$/
const RE_OTP = /^\d{6}$/

const {
  user,
  bindPhone,
  verifyBindPhone,
  loading: authLoading,
} = useTcbAuth()

const showModal = ref(false)
const phoneNumber = ref('')
const otpCode = ref('')
const bindData = ref<TcbBindVerificationData | null>(null)
const step = ref<'input' | 'verify'>('input')
const { remaining: countdown, isActive: countdownActive, start: startCountdown } = useCountdown()

const phoneValid = computed(() => RE_CN_PHONE.test(phoneNumber.value))
const phoneInvalid = computed(() => phoneNumber.value.length > 0 && !phoneValid.value)

watch(otpCode, (value) => {
  const sanitized = value.replace(/\D/g, '').slice(0, 6)
  if (sanitized !== value)
    otpCode.value = sanitized
})

function openModal() {
  showModal.value = true
  step.value = 'input'
  phoneNumber.value = ''
  otpCode.value = ''
  bindData.value = null
}

async function handleSendOtp() {
  if (!phoneValid.value)
    return
  try {
    bindData.value = await bindPhone(phoneNumber.value)
    step.value = 'verify'
    startCountdown()
  }
  catch {
    // 错误已在 composable 中处理
  }
}

async function handleVerify() {
  if (!bindData.value || !RE_OTP.test(otpCode.value))
    return
  try {
    await verifyBindPhone(bindData.value, phoneNumber.value, otpCode.value)
    showModal.value = false
  }
  catch {
    // 错误已在 composable 中处理
  }
}
</script>

<template>
  <SecurityCredentialRow
    :icon="SmartphoneIcon"
    label="手机号"
    :description="user?.phone ? `已绑定 ${maskPhone(user.phone)}` : '绑定后可使用短信验证码登录，也能用于找回账号'"
    :status="user?.phone ? '已绑定' : '未绑定'"
    :action="user?.phone ? '换绑' : '绑定'"
    accent="phone"
    :ready="!!user?.phone"
    action-test-id="phone-bind-action"
    @action="openModal"
  />

  <Dialog v-model:open="showModal">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <div class="flex items-center gap-2 text-xs font-medium text-primary">
          <SmartphoneIcon aria-hidden="true" />
          <span>手机号验证</span>
        </div>
        <DialogTitle>
          {{ user?.phone ? '换绑手机号' : '绑定手机号' }}
        </DialogTitle>
        <DialogDescription>
          {{ step === 'input' ? '输入中国大陆手机号，我们会发送一条短信验证码。' : `验证码已发送至 +86 ${phoneNumber}` }}
        </DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-5 px-6 pb-6">
        <SecurityVerificationProgress
          :current="step === 'input' ? 1 : 2"
          first-label="确认手机号"
          second-label="验证短信"
        />

        <form
          v-if="step === 'input'"
          id="phone-bind-form"
          @submit.prevent="handleSendOtp"
        >
          <FieldGroup>
            <Field :data-invalid="phoneInvalid">
              <FieldLabel for="phone-bind-number">
                手机号
              </FieldLabel>
              <InputGroup :data-invalid="phoneInvalid" :data-disabled="authLoading">
                <InputGroupAddon>
                  <InputGroupText>+86</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  id="phone-bind-number"
                  v-model="phoneNumber"
                  data-testid="phone-number-input"
                  type="tel"
                  inputmode="numeric"
                  autocomplete="tel-national"
                  placeholder="请输入手机号"
                  :aria-invalid="phoneInvalid"
                  :disabled="authLoading"
                />
              </InputGroup>
              <FieldError v-if="phoneInvalid">
                请输入正确的中国大陆手机号
              </FieldError>
              <FieldDescription v-else>
                当前仅支持中国大陆手机号
              </FieldDescription>
            </Field>
          </FieldGroup>
        </form>

        <form
          v-else
          id="phone-verify-form"
          @submit.prevent="handleVerify"
        >
          <FieldGroup>
            <Field>
              <FieldLabel>短信验证码</FieldLabel>
              <SecurityOtpInput
                v-model="otpCode"
                test-id="phone-otp-input"
                :disabled="authLoading"
                :countdown-active="countdownActive"
                :countdown="countdown"
                @resend="handleSendOtp"
              />
              <FieldDescription>
                输入短信中的 6 位数字验证码
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
          data-testid="phone-send-otp"
          type="submit"
          form="phone-bind-form"
          :disabled="!phoneValid || authLoading"
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
          data-testid="phone-confirm-bind"
          type="submit"
          form="phone-verify-form"
          :disabled="!RE_OTP.test(otpCode) || authLoading"
        >
          <Spinner v-if="authLoading" data-icon="inline-start" />
          <CheckIcon v-else data-icon="inline-start" />
          {{ authLoading ? '验证中' : '确认绑定' }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
