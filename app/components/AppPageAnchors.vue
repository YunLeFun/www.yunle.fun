<script setup lang="ts">
defineProps<{
  links: Array<{ label: string, to: string }>
}>()
</script>

<template>
  <nav class="flex flex-col gap-1" aria-label="本页目录">
    <NuxtLink
      v-for="link in links"
      :key="link.to"
      :to="link.to"
      class="rounded-lg px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {{ link.label }}
    </NuxtLink>
  </nav>
</template>
