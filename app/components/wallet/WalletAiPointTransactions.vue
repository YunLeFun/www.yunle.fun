<script setup lang="ts">
import type { AiPointTransaction } from '~/types/ai-points'

import { formatAiPoints as formatPoints } from '~/utils/ai-points'

const props = defineProps<{
  transactions: readonly AiPointTransaction[]
  loading: boolean
  loadingMore: boolean
  error: string | null
  hasMore: boolean
}>()
const emit = defineEmits<{ refresh: [], loadMore: [] }>()

const TRANSACTION_NAMES: Record<string, string> = {
  adjust: '点数调整',
  grant: 'AI 点数发放',
  refund: '任务退款',
  release: '退回预留点数',
  reserve: '任务预留',
  settle: '任务结算',
}

const APP_NAMES: Record<string, string> = {
  'advjs-studio': 'ADV.JS Studio',
  'yunle-wallet': '我的钱包',
  'yunlefun-ai': '云乐坊 AI',
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
  if (transaction.scope === 'coin-exchange' && transaction.type === 'grant')
    return '云币兑换'
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
    return `预留 ${formatPoints(Math.abs(transaction.reservedDelta))}`
  if (transaction.type === 'settle')
    return `实扣 ${formatPoints(Math.abs(transaction.chargedMicroPoints))}`
  const amount = transactionAmount(transaction)
  return `${amount > 0 ? '+' : ''}${formatPoints(amount)}`
}
</script>

<template>
  <section class="space-y-4" aria-labelledby="ai-point-transactions-heading">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 id="ai-point-transactions-heading" class="text-lg font-semibold">
          AI 点数明细
        </h2>
        <p class="mt-1 text-xs text-muted">
          每次兑换、使用与退回，都有记录可查。
        </p>
      </div>
      <AppButton variant="ghost" color="neutral" size="sm" icon="i-lucide-refresh-cw" :loading="props.loading" @click="emit('refresh')">
        刷新
      </AppButton>
    </div>

    <div v-if="props.error" class="rounded-xl border border-error/30 bg-error/8 px-4 py-3 text-sm text-error" role="alert">
      {{ props.error }}
    </div>

    <div v-if="props.transactions.length === 0 && !props.loading" class="ylf-empty-state rounded-2xl py-12 text-center text-muted">
      <Icon name="i-lucide-receipt-text" class="mx-auto mb-2 size-8 opacity-60" />
      <p>暂无 AI 点数记录</p>
      <p class="mt-1 text-xs">
        兑换点数或开始 AI 创作后，记录会显示在这里。
      </p>
    </div>

    <div v-else class="ylf-surface divide-y divide-default overflow-hidden rounded-2xl">
      <div v-for="transaction in props.transactions" :key="transaction.id" class="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-elevated/60">
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

    <div v-if="props.hasMore" class="text-center">
      <AppButton variant="outline" color="neutral" size="sm" :loading="props.loadingMore" @click="emit('loadMore')">
        加载更多
      </AppButton>
    </div>
  </section>
</template>
