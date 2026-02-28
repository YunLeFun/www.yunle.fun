<script setup lang="ts">
import type { CreateOrderResult, PaymentPhase, QueryOrderResult } from '~/types/payment'
import QRCode from 'qrcode'
import { detectPayType, formatPrice } from '~/composables/usePayment'

declare const WeixinJSBridge: undefined | {
  invoke: (api: string, params: Record<string, string>, callback: (res: { err_msg: string }) => void) => void
}

const { app } = useCloudbase()
const { user } = useTcbAuth()
const toast = useToast()

// 自定义金额（元）
const amountYuan = ref('0.01')
const description = ref('')
const phase = ref<PaymentPhase>('confirm')
const loading = ref(false)
const errorMessage = ref('')
const currentOrder = ref<CreateOrderResult | null>(null)
const qrCanvas = ref<HTMLCanvasElement | null>(null)
const payType = computed(() => detectPayType())
const logs = ref<string[]>([])

let pollTimer: ReturnType<typeof setInterval> | null = null

function addLog(msg: string) {
  logs.value.unshift(`[${new Date().toLocaleTimeString()}] ${msg}`)
}

// 金额（分）
const amountFen = computed(() => {
  const v = Number.parseFloat(amountYuan.value)
  if (Number.isNaN(v) || v <= 0)
    return 0
  return Math.round(v * 100)
})

const priceFormatted = computed(() => formatPrice(amountFen.value))

async function renderQRCode() {
  await nextTick()
  if (qrCanvas.value && currentOrder.value?.codeUrl) {
    await QRCode.toCanvas(qrCanvas.value, currentOrder.value.codeUrl, {
      width: 240,
      margin: 2,
      color: { dark: '#111827', light: '#FFFFFF' },
    })
  }
}

watch(() => phase.value, (p) => {
  if (p === 'paying' && currentOrder.value?.codeUrl) {
    renderQRCode()
  }
})

async function handlePay() {
  if (!user.value) {
    toast.add({ title: '请先登录', color: 'warning' })
    navigateTo('/login?redirect=/test/pay')
    return
  }
  if (amountFen.value < 1) {
    toast.add({ title: '金额最小 0.01 元', color: 'error' })
    return
  }

  loading.value = true
  errorMessage.value = ''
  const pt = detectPayType()
  addLog(`发起支付: ${amountYuan.value} 元, payType=${pt}`)

  try {
    const res = await app.callFunction({
      name: 'wxpay-order',
      data: {
        action: 'createTestOrder',
        amount: amountFen.value,
        payType: pt,
        description: description.value || undefined,
      },
    })

    const result = res.result as CreateOrderResult
    currentOrder.value = result
    phase.value = 'paying'
    addLog(`订单创建成功: ${result.outTradeNo}`)

    if (pt === 'native') {
      addLog(`codeUrl: ${result.codeUrl}`)
      startPolling(result.outTradeNo)
    }
    else if (pt === 'h5' && result.h5Url) {
      startPolling(result.outTradeNo)
      window.location.href = result.h5Url
    }
    else if (pt === 'jsapi' && result.jsapiParams) {
      invokeJsapi(result.jsapiParams, result.outTradeNo)
    }
  }
  catch (err: any) {
    addLog(`创建订单失败: ${err.message || err}`)
    errorMessage.value = err.message || '创建订单失败'
    phase.value = 'fail'
  }
  finally {
    loading.value = false
  }
}

function invokeJsapi(params: NonNullable<CreateOrderResult['jsapiParams']>, outTradeNo: string) {
  if (typeof WeixinJSBridge === 'undefined') {
    errorMessage.value = '请在微信浏览器中使用 JSAPI 支付'
    phase.value = 'fail'
    return
  }
  WeixinJSBridge.invoke('getBrandWCPayRequest', {
    appId: params.appId,
    timeStamp: params.timeStamp,
    nonceStr: params.nonceStr,
    package: params.package,
    signType: params.signType,
    paySign: params.paySign,
  }, (res: { err_msg: string }) => {
    if (res.err_msg === 'get_brand_wcpay_request:ok') {
      phase.value = 'success'
      addLog('JSAPI 支付成功')
    }
    else if (res.err_msg === 'get_brand_wcpay_request:cancel') {
      errorMessage.value = '支付已取消'
      phase.value = 'fail'
      addLog('JSAPI 支付取消')
    }
    else {
      startPolling(outTradeNo)
    }
  })
}

function startPolling(outTradeNo: string) {
  stopPolling()
  let attempts = 0
  addLog('开始轮询订单状态...')

  pollTimer = setInterval(async () => {
    attempts++
    if (attempts > 60) {
      stopPolling()
      errorMessage.value = '支付超时'
      phase.value = 'fail'
      addLog('轮询超时')
      return
    }

    try {
      const res = await app.callFunction({
        name: 'wxpay-order',
        data: { action: 'queryOrder', outTradeNo },
      })
      const result = res.result as QueryOrderResult
      if (result.status === 'paid') {
        stopPolling()
        phase.value = 'success'
        addLog('支付成功!')
      }
      else if (result.status === 'failed' || result.status === 'closed') {
        stopPolling()
        errorMessage.value = '支付失败或已关闭'
        phase.value = 'fail'
        addLog(`订单状态: ${result.status}`)
      }
    }
    catch {}
  }, 3000)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

function handleReset() {
  stopPolling()
  phase.value = 'confirm'
  currentOrder.value = null
  errorMessage.value = ''
}

onUnmounted(() => stopPolling())
</script>

<template>
  <UContainer class="py-12 max-w-xl">
    <div class="space-y-6">
      <div>
        <h1 class="text-2xl font-bold">
          支付测试
        </h1>
        <p class="text-sm text-muted mt-1">
          用于测试微信支付流程，支持自定义金额
        </p>
      </div>

      <!-- 确认阶段 -->
      <template v-if="phase === 'confirm'">
        <div class="rounded-xl border border-default p-5 space-y-4">
          <div class="space-y-2">
            <label class="text-sm font-medium">支付金额（元）</label>
            <UInput
              v-model="amountYuan"
              type="number"
              step="0.01"
              min="0.01"
              placeholder="0.01"
              size="lg"
            />
          </div>
          <div class="space-y-2">
            <label class="text-sm font-medium">商品描述（可选）</label>
            <UInput
              v-model="description"
              placeholder="测试支付"
            />
          </div>
          <div class="flex items-center justify-between text-sm">
            <span class="text-muted">支付方式</span>
            <span>
              <template v-if="payType === 'native'">微信扫码支付</template>
              <template v-else-if="payType === 'jsapi'">微信 JSAPI 支付</template>
              <template v-else>微信 H5 支付</template>
            </span>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-muted text-sm">实付金额</span>
            <span class="text-xl font-bold text-primary">{{ priceFormatted }}</span>
          </div>
          <UButton
            block
            size="lg"
            :loading="loading"
            :disabled="amountFen < 1"
            @click="handlePay"
          >
            立即支付 {{ priceFormatted }}
          </UButton>
        </div>
      </template>

      <!-- 支付中 -->
      <template v-else-if="phase === 'paying'">
        <div class="rounded-xl border border-default p-5">
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
                <UIcon name="i-lucide-loader-2" class="w-4 h-4 animate-spin" />
                <span>等待支付结果...</span>
              </div>
              <p class="text-xs text-muted">
                支付金额 <span class="font-semibold text-primary">{{ priceFormatted }}</span>
              </p>
            </div>
          </template>
          <template v-else>
            <div class="text-center space-y-4 py-8">
              <UIcon name="i-lucide-loader-2" class="w-12 h-12 mx-auto text-primary animate-spin" />
              <h3 class="text-lg font-semibold">
                正在跳转微信支付...
              </h3>
            </div>
          </template>
          <div class="flex justify-center mt-4">
            <UButton color="neutral" variant="ghost" size="sm" @click="handleReset">
              取消支付
            </UButton>
          </div>
        </div>
      </template>

      <!-- 支付成功 -->
      <template v-else-if="phase === 'success'">
        <div class="rounded-xl border border-default p-5 text-center space-y-4">
          <div class="flex items-center justify-center w-16 h-16 mx-auto rounded-full bg-success/10">
            <UIcon name="i-lucide-check" class="w-8 h-8 text-success" />
          </div>
          <h3 class="text-lg font-semibold">
            支付成功
          </h3>
          <p class="text-sm text-muted">
            订单号: {{ currentOrder?.outTradeNo }}
          </p>
          <UButton @click="handleReset">
            再次测试
          </UButton>
        </div>
      </template>

      <!-- 支付失败 -->
      <template v-else-if="phase === 'fail'">
        <div class="rounded-xl border border-default p-5 text-center space-y-4">
          <div class="flex items-center justify-center w-16 h-16 mx-auto rounded-full bg-error/10">
            <UIcon name="i-lucide-x" class="w-8 h-8 text-error" />
          </div>
          <h3 class="text-lg font-semibold">
            支付失败
          </h3>
          <p class="text-sm text-muted">
            {{ errorMessage || '支付过程中出现错误' }}
          </p>
          <div class="flex gap-3 justify-center">
            <UButton color="neutral" variant="outline" @click="handleReset">
              返回
            </UButton>
            <UButton @click="handlePay">
              重试
            </UButton>
          </div>
        </div>
      </template>

      <!-- 调试日志 -->
      <div v-if="logs.length" class="rounded-xl border border-default p-4">
        <div class="flex items-center justify-between mb-2">
          <span class="text-sm font-medium">调试日志</span>
          <UButton size="xs" color="neutral" variant="ghost" @click="logs = []">
            清空
          </UButton>
        </div>
        <div class="max-h-48 overflow-y-auto space-y-1">
          <p
            v-for="(log, i) in logs"
            :key="i"
            class="text-xs font-mono text-muted break-all"
          >
            {{ log }}
          </p>
        </div>
      </div>
    </div>
  </UContainer>
</template>
