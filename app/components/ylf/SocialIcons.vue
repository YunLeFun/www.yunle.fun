<script setup lang="ts">
import { socialList } from '~/config'
</script>

<template>
  <div
    class="inline-flex p-4 text-2xl"
  >
    <UButton size="xl" v-for="item in socialList" :key="item.to" :to="item.to" target="_blank" :icon="item.icon"
        :aria-label="item.title" color="neutral" variant="ghost" :title="item.title" />
  </div>
</template>
