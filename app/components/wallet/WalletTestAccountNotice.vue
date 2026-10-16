<script setup lang="ts">
const props = defineProps<{
  /** Unsupported feature identified by the account service. */
  feature: 'reward-history' | 'ai-point-exchange'
}>()
const title = computed(() => props.feature === 'reward-history'
  ? '测试账号暂不支持奖励历史'
  : '测试账号暂不支持 AI 点数兑换')
const description = computed(() => props.feature === 'reward-history'
  ? '此账号用于业务调试，不参与正式奖励。你仍可查看云币余额和明细。'
  : '此账号可查看已有 AI 点数和流水，暂不支持使用云币兑换点数。')
</script>

<template>
  <div class="flex items-start gap-3 rounded-xl border border-default bg-muted/30 p-4" role="status" :data-testid="`test-account-${feature}`">
    <Icon name="i-lucide-info" class="mt-0.5 size-5 shrink-0 text-muted" />
    <div class="space-y-1">
      <p class="text-sm font-medium text-highlighted">
        {{ title }}
      </p>
      <p class="text-sm leading-6 text-muted">
        {{ description }}
      </p>
    </div>
  </div>
</template>
