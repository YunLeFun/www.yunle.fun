<script setup lang="ts">
import { socialList } from '~/config'
</script>

<template>
  <div
    class="text-2xl p-4 inline-flex"
  >
    <UButton
      v-for="item in socialList" :key="item.to" size="xl" :to="item.to" target="_blank" :icon="item.icon"
      :aria-label="item.title" color="neutral" variant="ghost" :title="item.title"
    />
  </div>
</template>
