<script setup lang="ts">
import type { AiPointExchangeResult } from '~/types/ai-points'
import { formatAiPoints } from '~/utils/ai-points'

const props = defineProps<{ availableMicroPoints: number }>()
const emit = defineEmits<{ exchanged: [result: AiPointExchangeResult] }>()
const coin = useCoin()
const exchange = useAiPointExchange()
const amount = shallowRef<string | number>(10)
const confirmation = shallowRef<{ coinAmount: number, pointsPerCoin: number } | null>(null)
const success = shallowRef<AiPointExchangeResult | null>(null)
const modalOpen = computed({
  get: () => confirmation.value !== null,
  set: value => value ? undefined : confirmation.value = null,
})
const policy = exchange.policy
const coinAmount = computed(() => Number(amount.value))
const pointsPerCoin = computed(() => policy.value?.pointsPerCoin ?? 0)
const maxCoin = computed(() => Math.min(coin.balance.value, policy.value?.maxCoin ?? 0))
const inputError = computed(() => {
  if (!policy.value || amount.value === '')
    return ''
  if (!Number.isSafeInteger(coinAmount.value))
    return '请输入整数云币数量'
  if (coinAmount.value < policy.value.minCoin)
    return `至少兑换 ${policy.value.minCoin} 云币`
  if (coinAmount.value > policy.value.maxCoin)
    return `单次最多兑换 ${policy.value.maxCoin.toLocaleString()} 云币`
  if (coin.account.value && coinAmount.value > coin.balance.value)
    return `还差 ${(coinAmount.value - coin.balance.value).toLocaleString()} 云币，可先充值或减少数量`
  return ''
})
const valid = computed(() => Boolean(policy.value?.enabled && coin.account.value && !coin.error.value
  && !coin.loading.value && !inputError.value && amount.value !== '' && coinAmount.value > 0))
const previewPoints = computed(() => Number.isSafeInteger(coinAmount.value) && coinAmount.value > 0 && policy.value && coinAmount.value <= policy.value.maxCoin
  ? coinAmount.value * pointsPerCoin.value * 1_000
  : 0)
const presets = computed(() => [10, 50, 100].filter(value => value >= (policy.value?.minCoin ?? 1) && value <= (policy.value?.maxCoin ?? 10_000)))
const disabledInput = computed(() => exchange.submitting.value || Boolean(exchange.pending.value))

function review() {
  success.value = null
  if (exchange.pending.value) {
    confirmation.value = { coinAmount: exchange.pending.value.coinAmount, pointsPerCoin: exchange.pending.value.pointsPerCoin }
  }
  else if (valid.value) {
    confirmation.value = { coinAmount: coinAmount.value, pointsPerCoin: pointsPerCoin.value }
  }
}

async function confirm() {
  if (!confirmation.value)
    return
  const result = await exchange.exchange(confirmation.value.coinAmount, confirmation.value.pointsPerCoin)
  if (result) {
    success.value = result
    amount.value = ''
    confirmation.value = null
    emit('exchanged', result)
  }
  else if (!exchange.pending.value) {
    confirmation.value = null
  }
}

onMounted(() => {
  void exchange.refresh()
  if (!coin.account.value)
    void coin.refresh()
})
</script>

<template>
  <section class="exchange-panel" aria-labelledby="exchange-heading" :aria-busy="exchange.submitting.value">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 id="exchange-heading" class="text-lg font-semibold">
          为下一次灵感补充点数
        </h2>
        <p class="mt-1 text-sm text-muted">
          将云币兑换为 AI 点数，用于 AI 应用创作。
        </p>
      </div>
      <span class="exchange-direction" aria-label="云币兑换 AI 点数">
        <span class="asset-mark asset-mark-coin"><Icon name="i-lucide-coins" class="size-4" /></span>
        <Icon name="i-lucide-arrow-right" class="size-4 text-muted" />
        <span class="asset-mark asset-mark-points"><Icon name="i-lucide-sparkles" class="size-4" /></span>
      </span>
    </div>

    <div v-if="success" class="exchange-success mt-5 flex items-start gap-3 p-4" role="status">
      <Icon name="i-lucide-circle-check" class="mt-0.5 size-5 shrink-0" />
      <div>
        <p class="font-semibold">
          {{ formatAiPoints(success.creditedMicroPoints) }} AI 点数已到账
        </p>
        <p class="mt-1 text-sm">
          已使用 {{ success.coinAmount.toLocaleString() }} 云币，剩余 {{ success.coinBalance.toLocaleString() }} 云币。
        </p>
      </div>
    </div>

    <div v-if="exchange.loading.value && !policy" class="mt-6 space-y-3" aria-label="正在加载兑换规则">
      <AppSkeleton class="h-24 rounded-xl" />
      <AppSkeleton class="h-11 rounded-xl" />
    </div>
    <form v-else-if="policy?.enabled" class="mt-6 space-y-4" @submit.prevent="review">
      <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
        <label for="exchange-coin" class="font-medium">兑换数量</label>
        <span class="text-muted">1 云币 = {{ pointsPerCoin.toLocaleString() }} AI 点数</span>
      </div>
      <div class="exchange-amounts">
        <div class="min-w-0 space-y-2">
          <AppInput
            id="exchange-coin"
            v-model="amount"
            type="number"
            inputmode="numeric"
            :min="policy.minCoin"
            :max="policy.maxCoin"
            step="1"
            :disabled="disabledInput"
            :aria-invalid="Boolean(inputError)"
            aria-describedby="exchange-hint"
            class="exchange-input"
          >
            <template #trailing>
              <span class="text-sm text-muted">云币</span>
            </template>
          </AppInput>
          <p class="text-xs text-muted">
            {{ coin.loading.value ? '余额加载中…' : coin.account.value ? `可用 ${coin.balance.value.toLocaleString()} 云币` : '余额暂不可用' }}
          </p>
        </div>
        <Icon name="i-lucide-arrow-right" class="mt-4 size-5 text-muted" aria-hidden="true" />
        <div class="min-w-0 space-y-2" aria-live="polite" aria-atomic="true">
          <output for="exchange-coin" class="exchange-output flex min-h-14 flex-wrap items-baseline gap-x-2 px-4 py-3">
            <strong class="text-2xl leading-none tabular-nums">{{ previewPoints ? formatAiPoints(previewPoints) : '—' }}</strong>
            <span class="text-xs">AI 点数</span>
          </output>
          <p class="text-xs text-muted">
            确认后到账
          </p>
        </div>
      </div>
      <div class="flex flex-wrap gap-2" role="group" aria-label="快捷兑换数量">
        <AppButton
          v-for="preset in presets"
          :key="preset"
          size="sm"
          :variant="coinAmount === preset ? 'soft' : 'outline'"
          :tone="coinAmount === preset ? 'blue' : undefined"
          :aria-pressed="coinAmount === preset"
          :disabled="disabledInput"
          @click="amount = preset"
        >
          {{ preset }} 云币
        </AppButton>
        <AppButton size="sm" variant="ghost" color="neutral" :disabled="disabledInput || maxCoin < policy.minCoin || Boolean(coin.error.value)" @click="amount = maxCoin">
          {{ coin.balance.value > policy.maxCoin ? '单次上限' : '全部可用' }}
        </AppButton>
      </div>
      <p id="exchange-hint" class="min-h-5 text-xs" :class="inputError ? 'text-error' : 'text-muted'" :role="inputError ? 'alert' : undefined">
        {{ inputError || `每次可兑换 ${policy.minCoin}–${policy.maxCoin.toLocaleString()} 云币，AI 点数不支持兑回云币。` }}
      </p>
      <div v-if="coin.error.value" class="flex flex-wrap items-center justify-between gap-2 text-sm text-error" role="alert">
        云币余额未能更新
        <AppButton size="sm" variant="outline" color="neutral" :loading="coin.loading.value" @click="coin.refresh()">
          刷新余额
        </AppButton>
      </div>
      <div class="exchange-footer flex flex-wrap items-center justify-between gap-3 pt-4">
        <p class="text-xs text-muted tabular-nums">
          {{ valid ? `兑换后可用 ${formatAiPoints(props.availableMicroPoints + previewPoints)} 点` : '按需兑换，让创作继续' }}
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <AppButton v-if="coin.account.value && coinAmount > coin.balance.value" to="/wallet" variant="outline" color="neutral" size="sm">
            充值云币
          </AppButton>
          <AppButton type="submit" :disabled="!valid && !exchange.pending.value" :loading="exchange.submitting.value" icon="i-lucide-arrow-right-left">
            {{ exchange.pending.value ? '重试本次兑换' : '兑换 AI 点数' }}
          </AppButton>
        </div>
      </div>
    </form>
    <div v-else class="mt-6 space-y-3 py-4 text-sm text-muted">
      <p>{{ policy ? '云币兑换暂未开放，你仍可查看和使用已有 AI 点数。' : '暂时无法获取兑换规则，请稍后重试。' }}</p>
      <AppButton variant="outline" color="neutral" size="sm" :loading="exchange.loading.value" @click="exchange.refresh">
        重新加载
      </AppButton>
      <AppButton v-if="exchange.pending.value" size="sm" class="ml-2" @click="review">
        重试本次兑换
      </AppButton>
    </div>
    <p v-if="exchange.pending.value && !exchange.submitting.value" class="mt-3 text-sm text-muted" role="status">
      有一笔兑换等待确认结果，请重试本次兑换后再发起新的兑换。
    </p>
    <p v-if="exchange.error.value && !modalOpen" class="mt-3 text-sm text-error" role="alert">
      {{ exchange.error.value }}
    </p>

    <AppModal v-model:open="modalOpen" title="确认兑换 AI 点数" description="确认扣除的云币和收到的 AI 点数" :dismissible="!exchange.submitting.value" :close="!exchange.submitting.value">
      <div v-if="confirmation" class="space-y-5">
        <div>
          <h3 class="text-xl font-semibold">
            确认兑换 AI 点数
          </h3>
          <p class="mt-2 text-sm text-muted">
            兑换后不支持兑回云币，请确认数量。
          </p>
        </div>
        <dl class="exchange-receipt space-y-4 p-5">
          <div class="flex items-center justify-between gap-3">
            <dt class="text-sm text-muted">
              使用云币
            </dt><dd class="font-semibold tabular-nums">
              {{ confirmation.coinAmount.toLocaleString() }} 云币
            </dd>
          </div>
          <div class="flex items-center justify-between gap-3">
            <dt class="text-sm text-muted">
              获得点数
            </dt><dd class="text-xl font-bold text-primary tabular-nums">
              {{ (confirmation.coinAmount * confirmation.pointsPerCoin).toLocaleString() }} 点
            </dd>
          </div>
          <div class="flex items-center justify-between gap-3 text-xs text-muted">
            <dt>兑换比例</dt><dd>1 云币 = {{ confirmation.pointsPerCoin }} AI 点数</dd>
          </div>
        </dl>
        <p v-if="exchange.error.value" class="text-sm text-error" role="alert">
          {{ exchange.error.value }}
        </p>
        <div class="flex justify-end gap-2">
          <AppButton color="neutral" variant="outline" :disabled="exchange.submitting.value" @click="modalOpen = false">
            返回
          </AppButton>
          <AppButton :loading="exchange.submitting.value" @click="confirm">
            {{ exchange.pending.value ? '重试本次兑换' : '确认兑换' }}
          </AppButton>
        </div>
      </div>
    </AppModal>
  </section>
</template>

<style scoped>
.exchange-panel {
  padding: var(--ylf-space-6);
  border: 1px solid var(--ylf-c-border);
  border-radius: var(--ylf-radius-lg);
  background: var(--ylf-c-surface);
}
.exchange-direction {
  display: flex;
  align-items: center;
  gap: var(--ylf-space-2);
}
.asset-mark {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: var(--ylf-radius-sm);
}
.asset-mark-coin {
  background: var(--ylf-accent-sun-soft);
  color: var(--ylf-accent-sun-text);
}
.asset-mark-points {
  background: var(--ylf-accent-cyan-soft);
  color: var(--ylf-accent-cyan-text);
}
.exchange-amounts {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  gap: var(--ylf-space-3);
}
.exchange-input {
  min-height: 3.5rem;
  background: var(--ylf-c-bg);
}
.exchange-input :deep(input) {
  font-size: var(--ylf-text-xl);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.exchange-output {
  border-radius: var(--ylf-radius);
  background: var(--ylf-c-brand-soft);
  color: var(--ylf-c-brand);
  overflow-wrap: anywhere;
}
.exchange-footer {
  border-top: 1px solid var(--ylf-c-border);
}
.exchange-receipt {
  border-radius: var(--ylf-radius);
  background: var(--ylf-c-bg-soft);
}
.exchange-success {
  border-radius: var(--ylf-radius);
  background: var(--ylf-status-success-soft);
  color: var(--ylf-status-success-text);
}
@media (max-width: 639px) {
  .exchange-panel {
    padding: var(--ylf-space-4);
  }
  .exchange-amounts {
    gap: var(--ylf-space-2);
  }
}
</style>
