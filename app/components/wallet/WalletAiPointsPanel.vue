<script setup lang="ts">
import type { AiPointExchangeResult } from '~/types/ai-points'
import { formatAiPoints } from '~/utils/ai-points'

const emit = defineEmits<{ exchanged: [] }>()
const points = useAiPoints()

function handleExchanged(result: AiPointExchangeResult) {
  points.applyExchange(result)
  emit('exchanged')
}

onMounted(() => points.refresh())
</script>

<template>
  <section class="ai-wallet space-y-8" aria-label="AI 点数钱包">
    <div v-if="points.loading.value && !points.account.value" class="grid gap-5 lg:grid-cols-5" aria-label="正在加载 AI 点数">
      <AppSkeleton class="h-80 rounded-2xl lg:col-span-2" />
      <AppSkeleton class="h-80 rounded-2xl lg:col-span-3" />
    </div>

    <div v-else-if="points.error.value && !points.account.value" class="ylf-empty-state rounded-2xl px-6 py-12 text-center space-y-4" role="alert">
      <Icon name="i-lucide-cloud-alert" class="mx-auto size-8 text-error" />
      <div class="space-y-1">
        <h2 class="font-semibold">
          AI 点数暂时无法加载
        </h2>
        <p class="text-sm text-muted">
          {{ points.error.value }}
        </p>
      </div>
      <AppButton variant="outline" color="neutral" icon="i-lucide-refresh-cw" @click="points.refresh">
        重试
      </AppButton>
    </div>

    <template v-else-if="points.account.value">
      <div class="grid items-stretch gap-5 lg:grid-cols-5">
        <section class="balance-panel flex min-w-0 flex-col lg:col-span-2" aria-labelledby="ai-points-heading">
          <div class="flex items-center gap-3">
            <span class="balance-icon flex size-10 items-center justify-center"><Icon name="i-lucide-sparkles" class="size-5" /></span>
            <h2 id="ai-points-heading" class="text-sm font-medium">
              可用 AI 点数
            </h2>
            <AppButton href="#ai-point-exchange" variant="soft" size="sm" class="ml-auto lg:hidden">
              兑换点数
            </AppButton>
          </div>
          <p class="my-5 flex flex-wrap items-baseline gap-2">
            <strong class="balance-number font-semibold tracking-tight tabular-nums">{{ formatAiPoints(points.account.value.availableMicroPoints) }}</strong>
            <span class="text-sm text-muted">点</span>
          </p>
          <p class="max-w-sm text-sm leading-relaxed text-muted">
            {{ points.account.value.initialized ? '让灵感成为作品。AI 任务按实际用量结算，未使用的预留点数会自动退回。' : '尚未获得 AI 点数？用云币兑换，开始你的第一次 AI 创作。' }}
          </p>

          <div class="reserved-row mt-6 flex items-start gap-3 py-4">
            <Icon name="i-lucide-hourglass" class="mt-0.5 size-4 shrink-0 text-muted" />
            <div class="space-y-1">
              <p class="text-sm">
                任务预留 <strong class="tabular-nums">{{ formatAiPoints(points.account.value.reservedMicroPoints) }}</strong> 点
              </p>
              <p class="text-xs text-muted">
                {{ points.account.value.activeReservationCount > 0 ? `${points.account.value.activeReservationCount} 个任务进行中，预留点数暂不可使用` : '当前没有进行中的 AI 任务' }}
              </p>
            </div>
          </div>
          <dl class="mt-auto grid grid-cols-2 gap-4 pt-4">
            <div>
              <dt class="text-xs text-muted">
                累计获得
              </dt><dd class="mt-1 text-lg font-semibold tabular-nums">
                {{ formatAiPoints(points.account.value.lifetimeGrantedMicroPoints) }} <span class="text-xs font-normal text-muted">点</span>
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted">
                累计使用
              </dt><dd class="mt-1 text-lg font-semibold tabular-nums">
                {{ formatAiPoints(points.account.value.lifetimeChargedMicroPoints) }} <span class="text-xs font-normal text-muted">点</span>
              </dd>
            </div>
          </dl>
        </section>

        <WalletAiPointExchange id="ai-point-exchange" class="min-w-0 scroll-mt-24 lg:col-span-3" :available-micro-points="points.account.value.availableMicroPoints" @exchanged="handleExchanged" />
      </div>

      <WalletAiPointTransactions
        :transactions="points.transactions.value"
        :loading="points.loading.value"
        :loading-more="points.loadingMore.value"
        :error="points.error.value"
        :has-more="points.hasMore.value"
        @refresh="points.refresh"
        @load-more="points.loadMore"
      />
    </template>
  </section>
</template>

<style scoped>
.ai-wallet {
  font-family: var(--ylf-font-body);
  color: var(--ylf-c-text);
}
.balance-panel {
  padding: var(--ylf-space-6);
  border: 1px solid var(--ylf-c-border);
  border-radius: var(--ylf-radius-lg);
  background: var(--ylf-c-surface);
}
.balance-icon {
  border-radius: var(--ylf-radius);
  color: var(--ylf-accent-cyan-text);
  background: var(--ylf-accent-cyan-soft);
}
.balance-number {
  color: var(--ylf-c-brand);
  font-size: var(--ylf-text-display);
  line-height: 1.1;
  overflow-wrap: anywhere;
}
.reserved-row {
  border-top: 1px solid var(--ylf-c-border);
  border-bottom: 1px solid var(--ylf-c-border);
}
@media (max-width: 639px) {
  .balance-panel {
    padding: var(--ylf-space-4);
  }
}
</style>
