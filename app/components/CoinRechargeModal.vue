<script setup lang="ts">
import type { PaymentPhase } from '~/types/payment'
import QRCode from 'qrcode'
import { detectPayType, formatPrice } from '~/composables/usePaymentFlow'

const props = defineProps<{
  open: boolean
  coin: number
  price: number
  phase: PaymentPhase
  loading: boolean
  errorMessage: string
  codeUrl?: string
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'confirm': []
  'close': []
}>()

const qrCanvas = ref<HTMLCanvasElement | null>(null)
const payType = computed(() => detectPayType())
const priceFormatted = computed(() => formatPrice(props.price))
const { fromApps, returnToApp } = useAppsReturn()

async function renderQRCode() {
  if (!props.codeUrl)
    return
  await nextTick()
  if (qrCanvas.value) {
    await QRCode.toCanvas(qrCanvas.value, props.codeUrl, {
      width: 240,
      margin: 2,
      color: { dark: '#111827', light: '#FFFFFF' },
    })
  }
}

watch(() => props.codeUrl, renderQRCode)
watch(() => props.phase, (p) => {
  if (p === 'paying' && props.codeUrl)
    renderQRCode()
})
watch(() => props.open, (isOpen) => {
  if (isOpen && props.codeUrl)
    renderQRCode()
})

function handleClose() {
  emit('update:open', false)
  emit('close')
}
</script>

<template>
  <AppModal
    :open="open"
    title="云币充值"
    @update:open="$emit('update:open', $event)"
  >
    <template #content>
      <div class="p-6 space-y-5">
        <!-- 确认阶段 -->
        <template v-if="phase === 'confirm'">
          <div class="flex items-center gap-3">
            <div class="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10">
              <Icon name="i-lucide-coins" class="w-5 h-5 text-primary" />
            </div>
            <h3 class="text-lg font-semibold">
              确认充值
            </h3>
          </div>

          <div class="rounded-xl border border-default p-4 space-y-3">
            <div class="flex items-center justify-between">
              <span class="text-muted">充值数量</span>
              <span class="font-medium">{{ coin }} 云币</span>
            </div>
            <AppSeparator />
            <div class="flex items-center justify-between">
              <span class="text-muted">支付金额</span>
              <span class="text-xl font-bold text-primary">{{ priceFormatted }}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-muted">支付方式</span>
              <span class="text-sm">
                <template v-if="payType === 'native'">微信扫码支付</template>
                <template v-else-if="payType === 'jsapi'">微信支付</template>
                <template v-else>微信 H5 支付</template>
              </span>
            </div>
          </div>

          <p class="text-xs text-muted">
            云币为平台虚拟消费凭证，不可提现、不可转账。
          </p>

          <div class="flex gap-3 justify-end">
            <AppButton color="neutral" variant="outline" @click="handleClose">
              取消
            </AppButton>
            <AppButton :loading="loading" @click="$emit('confirm')">
              确认支付
            </AppButton>
          </div>
        </template>

        <!-- 支付中阶段 -->
        <template v-else-if="phase === 'paying'">
          <template v-if="payType === 'native'">
            <div class="text-center space-y-4">
              <h3 class="text-lg font-semibold">
                微信扫码支付
              </h3>
              <p class="text-sm text-muted">
                请使用微信扫描下方二维码完成支付
              </p>
              <div class="flex justify-center">
                <div class="rounded-xl border border-default p-3 bg-white inline-block">
                  <canvas ref="qrCanvas" class="block" />
                </div>
              </div>
              <div class="flex items-center justify-center gap-2 text-sm text-muted">
                <Icon name="i-lucide-loader-2" class="w-4 h-4 animate-spin" />
                <span>等待支付结果...</span>
              </div>
              <p class="text-xs text-muted">
                充值 <span class="font-semibold text-primary">{{ coin }} 云币</span> · {{ priceFormatted }}
              </p>
            </div>
          </template>

          <template v-else>
            <div class="text-center space-y-4 py-8">
              <Icon name="i-lucide-loader-2" class="w-12 h-12 mx-auto text-primary animate-spin" />
              <h3 class="text-lg font-semibold">
                正在跳转微信支付...
              </h3>
              <p class="text-sm text-muted">
                请在微信中完成支付操作
              </p>
            </div>
          </template>

          <div class="flex justify-center">
            <AppButton color="neutral" variant="ghost" size="sm" @click="handleClose">
              取消支付
            </AppButton>
          </div>
        </template>

        <!-- 支付成功 -->
        <template v-else-if="phase === 'success'">
          <div class="text-center space-y-4 py-4">
            <div class="flex items-center justify-center w-16 h-16 mx-auto rounded-full bg-success/10">
              <Icon name="i-lucide-check" class="w-8 h-8 text-success" />
            </div>
            <h3 class="text-lg font-semibold">
              充值成功
            </h3>
            <p class="text-sm text-muted">
              已到账 <span class="font-semibold text-primary">{{ coin }} 云币</span>
            </p>
          </div>
          <div class="flex gap-3 justify-center">
            <AppButton v-if="fromApps" color="neutral" variant="outline" @click="returnToApp">
              返回云乐坊
            </AppButton>
            <AppButton @click="handleClose">
              完成
            </AppButton>
          </div>
        </template>

        <!-- 支付失败 -->
        <template v-else-if="phase === 'fail'">
          <div class="text-center space-y-4 py-4">
            <div class="flex items-center justify-center w-16 h-16 mx-auto rounded-full bg-error/10">
              <Icon name="i-lucide-x" class="w-8 h-8 text-error" />
            </div>
            <h3 class="text-lg font-semibold">
              支付失败
            </h3>
            <p class="text-sm text-muted">
              {{ errorMessage || '支付过程中出现错误，请稍后重试' }}
            </p>
          </div>
          <div class="flex gap-3 justify-center">
            <AppButton color="neutral" variant="outline" @click="handleClose">
              关闭
            </AppButton>
            <AppButton @click="$emit('confirm')">
              重新支付
            </AppButton>
          </div>
        </template>
      </div>
    </template>
  </AppModal>
</template>
