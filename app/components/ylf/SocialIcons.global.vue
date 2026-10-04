<script setup lang="ts">
import type { SocialItem } from '~/config'
import { socialList } from '~/config'

withDefaults(defineProps<{
  items?: SocialItem[]
}>(), {
  items: () => socialList,
})
</script>

<template>
  <nav
    aria-label="社交链接"
    class="inline-flex max-w-full flex-wrap items-center gap-[var(--ylf-space-1)] text-muted-foreground"
  >
    <AppButton
      v-for="item in items" :key="item.to" size="icon-lg" :to="item.to" target="_blank" rel="noopener noreferrer"
      :icon="item.icon" :aria-label="`${item.title}（在新窗口打开）`" color="neutral" variant="ghost"
      :title="item.title"
      class="ylf-social-link"
      :style="{ '--ylf-social-color': item.hoverColor ?? `var(--ylf-social-${item.brand})` }"
    />
  </nav>
</template>

<style scoped>
.ylf-social-link {
  transition-duration: var(--ylf-duration-fast);
  transition-timing-function: var(--ylf-ease-standard);
}

.ylf-social-link:is(:hover, :focus-visible) {
  color: var(--ylf-social-color);
  background-color: color-mix(in srgb, var(--ylf-social-color) var(--ylf-social-hover-tint), transparent);
}
</style>
