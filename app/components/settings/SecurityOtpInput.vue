<script setup lang="ts">
import { RotateCwIcon } from '@lucide/vue'
import { REGEXP_ONLY_DIGITS } from 'vue-input-otp'
import { Button } from '@/components/ui/button'
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from '@/components/ui/input-otp'

const props = defineProps<{
  disabled?: boolean
  invalid?: boolean
  ariaDescribedby?: string
  countdownActive?: boolean
  countdown?: number
  testId?: string
}>()

const emit = defineEmits<{
  resend: []
}>()

const value = defineModel<string>({ required: true })
</script>

<template>
  <div class="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
    <InputOTP
      v-model="value"
      :data-testid="props.testId"
      :maxlength="6"
      :pattern="REGEXP_ONLY_DIGITS"
      :disabled="props.disabled"
      :aria-invalid="props.invalid || undefined"
      :aria-describedby="props.ariaDescribedby"
      autocomplete="one-time-code"
    >
      <InputOTPGroup>
        <InputOTPSlot v-for="index in 3" :key="index" :index="index - 1" class="size-10 sm:size-11" />
      </InputOTPGroup>
      <InputOTPSeparator />
      <InputOTPGroup>
        <InputOTPSlot v-for="index in 3" :key="index + 3" :index="index + 2" class="size-10 sm:size-11" />
      </InputOTPGroup>
    </InputOTP>
    <Button
      type="button"
      variant="outline"
      size="sm"
      :disabled="props.countdownActive || props.disabled"
      @click="emit('resend')"
    >
      <RotateCwIcon data-icon="inline-start" />
      {{ props.countdownActive ? `${props.countdown} 秒` : '重新发送' }}
    </Button>
  </div>
</template>
