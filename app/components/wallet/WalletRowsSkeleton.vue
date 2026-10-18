<script setup lang="ts">
/**
 * 钱包明细列表的晴空骨架：与正式行同形（图标 + 两行文字 + 右侧金额），
 * 首屏加载时占位，避免列表出现后整体跳动。
 */
withDefaults(defineProps<{
  rows?: number
  label: string
}>(), {
  rows: 3,
})
</script>

<template>
  <div class="ylf-surface divide-y divide-default overflow-hidden rounded-2xl" aria-busy="true" :aria-label="label">
    <div v-for="n in rows" :key="n" class="flex items-center justify-between gap-3 px-4 py-3">
      <div class="flex min-w-0 flex-1 items-center gap-3">
        <div class="ylf-shimmer size-9 shrink-0 rounded-xl" />
        <div class="flex-1 space-y-2">
          <div class="ylf-shimmer h-3.5 w-2/5 rounded-full" />
          <div class="ylf-shimmer h-3 w-1/3 rounded-full" />
        </div>
      </div>
      <div class="ylf-shimmer h-4 w-14 shrink-0 rounded-full" />
    </div>
  </div>
</template>
