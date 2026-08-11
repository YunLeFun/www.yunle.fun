<script setup lang="ts">
import { socialList } from '~/config'
</script>

<template>
  <div
    class="text-2xl p-4 inline-flex"
  >
    <AppButton
      v-for="item in socialList" :key="item.to" size="xl" :to="item.to" target="_blank" rel="noopener noreferrer"
      :icon="item.icon" :aria-label="`${item.title}（在新窗口打开）`" color="neutral" variant="ghost"
      :title="item.title"
    />
  </div>
</template>
