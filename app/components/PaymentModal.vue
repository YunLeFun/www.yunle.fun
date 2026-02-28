<script setup lang="ts">
import type { PaymentPhase } from '~/types/payment'
import QRCode from 'qrcode'
import { detectPayType, formatPrice } from '~/composables/usePayment'

const props = defineProps<{
  open: boolean
  planName: string
  price: number
  billingCycle: string
  phase: PaymentPhase
  loading: boolean
  errorMessage: string
  codeUrl?: string
  planId?: string
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'confirm': []
  'close': []
  'switchCycle': [cycle: 'month' | 'year']
}>()

// 当前是否为年付
const isYearly = computed(() => props.billingCycle === 'year')

const qrCanvas = ref<HTMLCanvasElement | null>(null)
const payType = computed(() => detectPayType())

const priceFormatted = computed(() => formatPrice(props.price))
const cycleLabel = computed(() => props.billingCycle === 'year' ? '年付' : '月付')

// 生成二维码
watch(
  () => props.codeUrl,
  async (url) => {
    if (url && qrCanvas.value) {
      await QRCode.toCanvas(qrCanvas.value, url, {
        width: 240,
        margin: 2,
        color: {
          dark: '#111827',
          light: '#FFFFFF',
        },
      })
    }
  },
)

// 弹窗打开后生成二维码
watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen && props.codeUrl) {
      await nextTick()
      if (qrCanvas.value) {
        await QRCode.toCanvas(qrCanvas.value, props.codeUrl, {
          width: 240,
          margin: 2,
          color: {
            dark: '#111827',
            light: '#FFFFFF',
          },
        })
      }
    }
  },
)

function handleClose() {
  emit('update:open', false)
  emit('close')
}
</script>

<template>
  <UModal
    :open="open"
    @update:open="$emit('update:open', $event)"
  >
    <template #title>
      <span class="sr-only">支付</span>
    </template>
    <template #content>
      <div class="p-6 space-y-5">
        <!-- 确认阶段 -->
        <template v-if="phase === 'confirm'">
          <div class="flex items-center gap-3">
            <div class="flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10">
              <UIcon
                name="i-lucide-credit-card"
                class="w-5 h-5 text-primary"
              />
            </div>
            <h3 class="text-lg font-semibold">
              确认购买
            </h3>
          </div>

          <div class="rounded-xl border border-default p-4 space-y-3">
            <div class="flex items-center justify-between">
              <span class="text-muted">套餐</span>
              <span class="font-medium">{{ planName }}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-muted">计费方式</span>
              <div class="flex items-center gap-2">
                <span
                  class="font-medium cursor-pointer hover:text-primary transition-colors"
                  :class="{ 'text-primary': !isYearly }"
                  @click="!isYearly || emit('switchCycle', 'month')"
                >
                  月付
                </span>
                <span class="text-muted">/</span>
                <span
                  class="font-medium cursor-pointer hover:text-primary transition-colors"
                  :class="{ 'text-primary': isYearly }"
                  @click="isYearly || emit('switchCycle', 'year')"
                >
                  年付
                </span>
              </div>
            </div>
            <USeparator />
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

          <div class="flex gap-3 justify-end">
            <UButton
              color="neutral"
              variant="outline"
              @click="handleClose"
            >
              取消
            </UButton>
            <UButton
              :loading="loading"
              @click="$emit('confirm')"
            >
              确认支付
            </UButton>
          </div>
        </template>

        <!-- 支付中阶段 -->
        <template v-else-if="phase === 'paying'">
          <!-- Native 扫码 -->
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
                  <canvas
                    ref="qrCanvas"
                    class="block"
                  />
                </div>
              </div>
              <div class="flex items-center justify-center gap-2 text-sm text-muted">
                <UIcon
                  name="i-lucide-loader-2"
                  class="w-4 h-4 animate-spin"
                />
                <span>等待支付结果...</span>
              </div>
              <p class="text-xs text-muted">
                支付金额 <span class="font-semibold text-primary">{{ priceFormatted }}</span>
              </p>
            </div>
          </template>

          <!-- H5 / JSAPI -->
          <template v-else>
            <div class="text-center space-y-4 py-8">
              <UIcon
                name="i-lucide-loader-2"
                class="w-12 h-12 mx-auto text-primary animate-spin"
              />
              <h3 class="text-lg font-semibold">
                正在跳转微信支付...
              </h3>
              <p class="text-sm text-muted">
                请在微信中完成支付操作
              </p>
            </div>
          </template>

          <div class="flex justify-center">
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              @click="handleClose"
            >
              取消支付
            </UButton>
          </div>
        </template>

        <!-- 支付成功 -->
        <template v-else-if="phase === 'success'">
          <div class="text-center space-y-4 py-4">
            <div class="flex items-center justify-center w-16 h-16 mx-auto rounded-full bg-success/10">
              <UIcon
                name="i-lucide-check"
                class="w-8 h-8 text-success"
              />
            </div>
            <h3 class="text-lg font-semibold">
              支付成功
            </h3>
            <p class="text-sm text-muted">
              {{ planName }} 套餐（{{ cycleLabel }}）已开通
            </p>
          </div>
          <div class="flex justify-center">
            <UButton @click="handleClose">
              完成
            </UButton>
          </div>
        </template>

        <!-- 支付失败 -->
        <template v-else-if="phase === 'fail'">
          <div class="text-center space-y-4 py-4">
            <div class="flex items-center justify-center w-16 h-16 mx-auto rounded-full bg-error/10">
              <UIcon
                name="i-lucide-x"
                class="w-8 h-8 text-error"
              />
            </div>
            <h3 class="text-lg font-semibold">
              支付失败
            </h3>
            <p class="text-sm text-muted">
              {{ errorMessage || '支付过程中出现错误，请稍后重试' }}
            </p>
          </div>
          <div class="flex gap-3 justify-center">
            <UButton
              color="neutral"
              variant="outline"
              @click="handleClose"
            >
              关闭
            </UButton>
            <UButton @click="$emit('confirm')">
              重新支付
            </UButton>
          </div>
        </template>
      </div>
    </template>
  </UModal>
</template>
