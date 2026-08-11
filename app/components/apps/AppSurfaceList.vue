<script setup lang="ts">
import type { AppRecord } from '~/types/app'

withDefaults(defineProps<{
  apps: AppRecord[]
  showAudience?: boolean
  compact?: boolean
}>(), {
  showAudience: false,
  compact: false,
})

function appHref(app: AppRecord) {
  return `https://apps.yunle.fun/app/${encodeURIComponent(app.slug)}`
}

function audienceLabel(app: AppRecord) {
  if (app.audience === 'workshop')
    return '坊客专属'
  if (app.audience === 'owner')
    return '仅自己'
  return '主页公开'
}

function audienceIcon(app: AppRecord) {
  if (app.audience === 'workshop')
    return 'i-lucide-key-round'
  if (app.audience === 'owner')
    return 'i-lucide-lock-keyhole'
  return 'i-lucide-globe-2'
}
</script>

<template>
  <div class="grid gap-2" :class="compact ? '' : 'sm:grid-cols-2'">
    <a
      v-for="item in apps"
      :key="item._id"
      :href="appHref(item)"
      target="_blank"
      rel="noopener noreferrer"
      class="app-surface-item group"
    >
      <span
        class="app-surface-item__icon"
        :style="{ '--app-color': item.themeColor || 'var(--ylf-dopa-blue)' }"
      >
        <img
          v-if="item.icon || item.logo"
          :src="item.icon || item.logo"
          :alt="item.name"
          loading="lazy"
        >
        <span v-else-if="item.emoji" aria-hidden="true">{{ item.emoji }}</span>
        <Icon v-else name="i-lucide-cloud" aria-hidden="true" />
      </span>

      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm font-semibold text-highlighted transition-colors group-hover:text-primary">
          {{ item.name }}
        </span>
        <span class="mt-0.5 block truncate text-xs text-muted">
          {{ item.description || item.category || item.slug }}
        </span>
      </span>

      <span
        v-if="showAudience"
        class="app-surface-item__audience"
      >
        <Icon :name="audienceIcon(item)" aria-hidden="true" />
        {{ audienceLabel(item) }}
      </span>
      <Icon
        v-else
        name="i-lucide-arrow-up-right"
        class="size-4 shrink-0 text-dimmed transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary"
        aria-hidden="true"
      />
    </a>
  </div>
</template>

<style scoped>
.app-surface-item {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.75rem;
  border: 1px solid var(--ui-border-muted);
  border-radius: 1rem;
  padding: 0.75rem;
  background: color-mix(in srgb, var(--ylf-surface-muted) 56%, transparent);
  transition:
    border-color 160ms ease,
    background-color 160ms ease,
    transform 160ms ease;
}

.app-surface-item:hover {
  border-color: color-mix(in srgb, var(--ui-primary) 32%, var(--ui-border));
  background: color-mix(in srgb, var(--ui-primary) 5%, var(--ylf-surface));
  transform: translateY(-1px);
}

.app-surface-item:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 3px;
}

.app-surface-item__icon {
  display: grid;
  width: 2.5rem;
  height: 2.5rem;
  flex: 0 0 auto;
  place-items: center;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--app-color) 26%, transparent);
  border-radius: 0.8rem;
  background: color-mix(in srgb, var(--app-color) 13%, var(--ylf-surface));
  color: var(--app-color);
  font-size: 1.3rem;
}

.app-surface-item__icon img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.app-surface-item__audience {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.25rem;
  border-radius: 999px;
  padding: 0.25rem 0.45rem;
  background: color-mix(in srgb, var(--ui-primary) 8%, transparent);
  color: var(--ui-text-muted);
  font-size: 0.65rem;
  font-weight: 700;
  white-space: nowrap;
}

.app-surface-item__audience :deep(svg) {
  width: 0.7rem;
  height: 0.7rem;
}

@media (prefers-reduced-motion: reduce) {
  .app-surface-item,
  .app-surface-item :deep(svg) {
    transition: none;
  }
}
</style>
