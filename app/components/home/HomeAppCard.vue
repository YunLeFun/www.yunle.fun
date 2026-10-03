<script setup lang="ts">
import type { SsoExplorerApp } from '~/types/app-explorer'
import AppProductIcon from '~/components/apps/AppProductIcon.vue'

defineProps<{
  app: SsoExplorerApp
}>()
</script>

<template>
  <article
    class="home-app-card"
    :style="{ '--app-accent': app.accent }"
    :data-testid="`sso-app-${app.appId}`"
  >
    <a :href="app.origin" target="_blank" rel="noopener noreferrer" class="home-app-card__link">
      <span class="home-app-card__art" aria-hidden="true">
        <Icon name="i-lucide-cloud" class="home-app-card__cloud" />
        <AppProductIcon :app="app" class="home-app-card__logo" />
        <span class="home-app-card__arrow">
          <Icon name="i-lucide-arrow-up-right" />
        </span>
      </span>
      <span class="home-app-card__copy">
        <strong>{{ app.name }}</strong>
        <span class="home-app-card__description">{{ app.description }}</span>
        <span class="home-app-card__status">
          <Icon name="i-lucide-badge-check" aria-hidden="true" />
          统一账号
        </span>
      </span>
      <span class="sr-only">，在新标签页打开</span>
    </a>
    <NuxtLink
      v-if="app.detailSlug"
      :to="`/apps/${app.detailSlug}`"
      class="home-app-card__detail"
      :aria-label="`查看 ${app.name} 的站内详情`"
    >
      详情
      <Icon name="i-lucide-arrow-right" aria-hidden="true" />
    </NuxtLink>
  </article>
</template>

<style scoped>
.home-app-card {
  position: relative;
  min-width: 0;
  border: 1px solid var(--ui-border-muted);
  border-radius: 1.35rem;
  background: var(--ui-bg-elevated);
  box-shadow: 0 3px 5px -3px color-mix(in srgb, var(--ylf-shadow-color) 8%, transparent);
  transition:
    border-color 180ms ease,
    box-shadow 180ms ease;
}

.home-app-card__link {
  display: flex;
  height: 100%;
  flex-direction: column;
  gap: 0.85rem;
  border-radius: inherit;
  padding: 0.55rem;
}

.home-app-card__art {
  position: relative;
  display: grid;
  height: 6.25rem;
  flex: none;
  place-items: center;
  overflow: hidden;
  border-radius: 0.95rem;
  background: color-mix(in srgb, var(--app-accent) 9%, var(--ui-bg-muted));
}

.home-app-card__cloud {
  position: absolute;
  right: -1.25rem;
  bottom: -1.3rem;
  width: 8rem;
  height: 8rem;
  color: color-mix(in srgb, var(--app-accent) 9%, transparent);
  stroke-width: 0.75;
}

.home-app-card__logo {
  z-index: 1;
  font-size: 1.2rem;
  transition: transform 180ms ease;
}

.home-app-card__arrow {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  display: grid;
  width: 1.75rem;
  height: 1.75rem;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--ui-border-muted) 55%, transparent);
  border-radius: 50%;
  background: color-mix(in srgb, var(--ui-bg-elevated) 70%, transparent);
  color: var(--ui-text-muted);
  transition:
    color 180ms ease,
    background-color 180ms ease;
}

.home-app-card__arrow :deep(svg) {
  width: 0.85rem;
  height: 0.85rem;
}

.home-app-card__copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  padding: 0 0.55rem 0.5rem;
}

.home-app-card__copy strong {
  color: var(--ui-text-highlighted);
  font-size: 0.95rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.home-app-card__description {
  margin-top: 0.3rem;
  color: var(--ui-text-muted);
  font-size: 0.75rem;
  line-height: 1.65;
}

.home-app-card__status {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  margin-top: auto;
  padding-top: 0.85rem;
  color: var(--ui-text-muted);
  font-size: 0.65rem;
}

.home-app-card__status :deep(svg) {
  width: 0.85rem;
  height: 0.85rem;
  color: var(--ui-primary);
}

.home-app-card__detail {
  position: absolute;
  right: 1.1rem;
  bottom: 0.35rem;
  display: inline-flex;
  min-height: 2.75rem;
  min-width: 3rem;
  align-items: center;
  gap: 0.2rem;
  border-radius: 0.3rem;
  color: var(--ui-primary);
  font-size: 0.7rem;
}

.home-app-card__detail :deep(svg) {
  width: 0.75rem;
  height: 0.75rem;
}

.home-app-card:hover,
.home-app-card:focus-within {
  border-color: color-mix(in srgb, var(--app-accent) 35%, var(--ui-border));
  box-shadow: 0 8px 20px -10px color-mix(in srgb, var(--app-accent) 25%, transparent);
}

.home-app-card__link:hover .home-app-card__logo {
  transform: translateY(-2px);
}

.home-app-card__link:hover .home-app-card__arrow {
  background: var(--ui-bg-elevated);
  color: var(--app-accent);
}

.home-app-card__link:focus-visible,
.home-app-card__detail:focus-visible {
  outline: 2px solid var(--ui-primary);
  outline-offset: 3px;
}

@media (prefers-reduced-motion: reduce) {
  .home-app-card,
  .home-app-card__logo,
  .home-app-card__arrow {
    transition: none;
  }

  .home-app-card__link:hover .home-app-card__logo {
    transform: none;
  }
}
</style>
