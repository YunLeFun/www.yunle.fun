<script setup lang="ts">
import type { AiPointTransaction } from '~/types/ai-points'

const points = useAiPoints()

const TRANSACTION_NAMES: Record<string, string> = {
  adjust: '点数调整',
  grant: 'AI 点数发放',
  refund: '任务退款',
  release: '预占释放',
  reserve: '任务预占',
  settle: '任务结算',
}

const APP_NAMES: Record<string, string> = {
  'advjs-studio': 'ADV.JS Studio',
}

function formatPoints(microPoints: number): string {
  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: 3,
    minimumFractionDigits: 0,
  }).format(microPoints / 1_000)
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function transactionName(transaction: AiPointTransaction): string {
  return TRANSACTION_NAMES[transaction.type] || transaction.type
}

function appName(appId: string): string {
  return APP_NAMES[appId] || appId
}

function transactionAmount(transaction: AiPointTransaction): number {
  if (transaction.type === 'settle')
    return -Math.abs(transaction.chargedMicroPoints)
  return transaction.availableDelta
}

function transactionAmountLabel(transaction: AiPointTransaction): string {
  if (transaction.type === 'reserve')
    return `预占 ${formatPoints(Math.abs(transaction.reservedDelta))}`
  if (transaction.type === 'settle')
    return `实扣 ${formatPoints(Math.abs(transaction.chargedMicroPoints))}`
  const amount = transactionAmount(transaction)
  return `${amount > 0 ? '+' : ''}${formatPoints(amount)}`
}

onMounted(() => points.refresh())
</script>

<template>
  <section class="space-y-6" aria-labelledby="ai-points-heading">
    <div v-if="points.loading.value && !points.account.value" class="grid gap-4 sm:grid-cols-3" aria-label="正在加载 AI 点数">
      <AppSkeleton class="h-40 rounded-2xl sm:col-span-2" />
      <AppSkeleton class="h-40 rounded-2xl" />
    </div>

    <div v-else-if="points.error.value && !points.account.value" class="ylf-empty-state rounded-2xl px-6 py-12 text-center space-y-4" role="alert">
      <Icon name="i-lucide-cloud-alert" class="mx-auto size-8 text-error" />
      <div class="space-y-1">
        <h2 id="ai-points-heading" class="font-semibold">
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
      <div v-if="!points.account.value.initialized" class="ylf-empty-state rounded-2xl px-6 py-12 text-center space-y-3">
        <span class="ylf-icon-tile mx-auto flex size-14 items-center justify-center rounded-2xl">
          <Icon name="i-lucide-sparkles" class="size-7" />
        </span>
        <div class="space-y-1">
          <h2 id="ai-points-heading" class="font-semibold">
            尚未获得 AI 点数
          </h2>
          <p class="mx-auto max-w-lg text-sm text-muted">
            AI 点数独立于云币，由接入统一账本的 AI 应用按规则发放和扣除；首次获得后会在这里显示余额与流水。
          </p>
        </div>
      </div>

      <template v-else>
        <div class="grid gap-4 sm:grid-cols-3">
          <div class="ylf-brand-bg relative overflow-hidden rounded-2xl p-6 text-white shadow-lg shadow-primary/20 sm:col-span-2">
            <Icon name="i-lucide-sparkles" class="pointer-events-none absolute -right-3 -bottom-5 size-32 opacity-15" />
            <div class="relative">
              <p id="ai-points-heading" class="text-sm/relaxed text-white/80">
                可用 AI 点数
              </p>
              <div class="mt-2 flex items-end gap-2">
                <strong class="text-5xl font-extrabold tabular-nums leading-none">{{ formatPoints(points.account.value.availableMicroPoints) }}</strong>
                <span class="pb-1 text-white/80">点</span>
              </div>
              <p class="mt-3 text-xs text-white/70">
                独立于云币 · 按 AI 任务实际用量结算
              </p>
            </div>
          </div>

          <div class="ylf-surface flex flex-col justify-between rounded-2xl p-6">
            <div>
              <p class="text-sm text-muted">
                当前预占
              </p>
              <p class="mt-2 text-3xl font-bold tabular-nums">
                {{ formatPoints(points.account.value.reservedMicroPoints) }}
              </p>
            </div>
            <p class="mt-4 text-xs text-muted">
              {{ points.account.value.activeReservationCount > 0 ? `${points.account.value.activeReservationCount} 个任务进行中，完成后按实际用量结算` : '当前没有进行中的 AI 任务' }}
            </p>
          </div>
        </div>

        <div class="grid gap-3 sm:grid-cols-2">
          <div class="ylf-soft-panel rounded-2xl p-4">
            <p class="text-xs text-muted">
              累计发放
            </p>
            <p class="mt-1 text-xl font-semibold tabular-nums">
              {{ formatPoints(points.account.value.lifetimeGrantedMicroPoints) }} 点
            </p>
          </div>
          <div class="ylf-soft-panel rounded-2xl p-4">
            <p class="text-xs text-muted">
              累计使用
            </p>
            <p class="mt-1 text-xl font-semibold tabular-nums">
              {{ formatPoints(points.account.value.lifetimeChargedMicroPoints) }} 点
            </p>
          </div>
        </div>

        <section class="space-y-4" aria-labelledby="ai-point-transactions-heading">
          <div class="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="ai-point-transactions-heading" class="text-lg font-semibold">
                AI 点数明细
              </h2>
              <p class="mt-1 text-xs text-muted">
                仅展示本人的不可变账本记录，不包含内部操作凭据。
              </p>
            </div>
            <AppButton variant="ghost" color="neutral" size="sm" icon="i-lucide-refresh-cw" :loading="points.loading.value" @click="points.refresh">
              刷新
            </AppButton>
          </div>

          <div v-if="points.error.value" class="rounded-xl border border-error/30 bg-error/8 px-4 py-3 text-sm text-error" role="alert">
            {{ points.error.value }}
          </div>

          <div v-if="points.transactions.value.length === 0 && !points.loading.value" class="ylf-empty-state rounded-2xl py-12 text-center text-muted">
            <Icon name="i-lucide-receipt-text" class="mx-auto mb-2 size-8 opacity-60" />
            <p>暂无 AI 点数记录</p>
          </div>

          <div v-else class="ylf-surface divide-y divide-default overflow-hidden rounded-2xl">
            <div v-for="transaction in points.transactions.value" :key="transaction.id" class="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-elevated/60">
              <div class="flex min-w-0 items-center gap-3">
                <span class="flex size-9 shrink-0 items-center justify-center rounded-xl" :class="transactionAmount(transaction) >= 0 ? 'bg-success/12 text-success' : 'bg-elevated text-dimmed'">
                  <Icon :name="transactionAmount(transaction) >= 0 ? 'i-lucide-arrow-down-left' : 'i-lucide-arrow-up-right'" class="size-4" />
                </span>
                <div class="min-w-0 space-y-0.5">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="font-medium">{{ transactionName(transaction) }}</span>
                    <AppBadge color="neutral" variant="subtle" size="sm">
                      {{ appName(transaction.appId) }}
                    </AppBadge>
                  </div>
                  <p class="text-xs text-muted">
                    {{ formatDate(transaction.createdAt) }}
                  </p>
                </div>
              </div>
              <div class="shrink-0 text-right">
                <div class="font-semibold tabular-nums" :class="transactionAmount(transaction) >= 0 ? 'text-success' : 'text-highlighted'">
                  {{ transactionAmountLabel(transaction) }}
                </div>
                <div class="text-xs text-muted">
                  可用 {{ formatPoints(transaction.availableAfter) }}
                </div>
              </div>
            </div>
          </div>

          <div v-if="points.hasMore.value" class="text-center">
            <AppButton variant="outline" color="neutral" size="sm" :loading="points.loadingMore.value" @click="points.loadMore">
              加载更多
            </AppButton>
          </div>
        </section>
      </template>
    </template>
  </section>
</template>
