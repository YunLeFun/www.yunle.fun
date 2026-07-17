<script setup lang="ts">
import type { ExplorerApp } from '~/types/app-explorer'
import { computed, shallowRef } from 'vue'
import AppExplorerIcon from './AppExplorerIcon.vue'

const props = defineProps<{
  app: ExplorerApp
}>()

const spotlightX = shallowRef(50)
const spotlightY = shallowRef(20)
const appUrl = computed(() => props.app.websiteUrl || props.app.backupUrl)

function updateSpotlight(event: PointerEvent) {
  const element = event.currentTarget as HTMLElement
  const bounds = element.getBoundingClientRect()
  spotlightX.value = ((event.clientX - bounds.left) / bounds.width) * 100
  spotlightY.value = ((event.clientY - bounds.top) / bounds.height) * 100
}
</script>

<template>
  <!-- Spotlight interaction adapted from Inspira UI Card Spotlight (MIT): https://github.com/unovue/inspira-ui -->
  <article
    class="app-discovery-card"
    :style="{
      '--app-accent': app.accent,
      '--spotlight-x': `${spotlightX}%`,
      '--spotlight-y': `${spotlightY}%`,
    }"
    @pointermove="updateSpotlight"
  >
    <div class="app-discovery-card__content">
      <header class="app-discovery-card__header">
        <AppExplorerIcon :app="app" />
        <div class="app-discovery-card__heading">
          <div class="app-discovery-card__eyebrow">
            <span>{{ app.categoryLabel }}</span>
            <span v-if="app.featured" class="app-discovery-card__featured">精选</span>
          </div>
          <h3 class="app-discovery-card__title">
            <NuxtLink :to="`/apps/${app.slug}`">
              {{ app.name }}
            </NuxtLink>
          </h3>
        </div>
      </header>

      <p class="app-discovery-card__description">
        {{ app.description || '一朵等待你亲自探索的应用云。' }}
      </p>

      <ul v-if="app.tags.length" class="app-discovery-card__tags" aria-label="应用标签">
        <li v-for="tag in app.tags.slice(0, 3)" :key="tag">
          {{ tag }}
        </li>
      </ul>

      <footer class="app-discovery-card__actions">
        <NuxtLink :to="`/apps/${app.slug}`" class="app-discovery-card__detail-link">
          查看详情
          <UIcon name="i-lucide-arrow-right" aria-hidden="true" />
        </NuxtLink>
        <a
          v-if="appUrl"
          :href="appUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="app-discovery-card__external-link"
        >
          打开应用
          <UIcon name="i-lucide-external-link" aria-hidden="true" />
        </a>
      </footer>
    </div>
  </article>
</template>

<style scoped>
.app-discovery-card {
  position: relative;
  min-height: 19rem;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--ui-border) 78%, transparent);
  border-radius: 1.5rem;
  background: color-mix(in srgb, var(--ui-bg) 88%, transparent);
  box-shadow: 0 18px 55px color-mix(in srgb, var(--app-accent) 7%, transparent);
  transition:
    border-color 180ms ease,
    box-shadow 180ms ease,
    transform 180ms ease;
}

.app-discovery-card::before {
  position: absolute;
  z-index: 0;
  border-radius: inherit;
  background: radial-gradient(
    28rem circle at var(--spotlight-x) var(--spotlight-y),
    color-mix(in srgb, var(--app-accent) 20%, transparent),
    transparent 55%
  );
  content: '';
  inset: 0;
  opacity: 0.75;
  pointer-events: none;
}

.app-discovery-card:hover,
.app-discovery-card:focus-within {
  border-color: color-mix(in srgb, var(--app-accent) 42%, var(--ui-border));
  box-shadow: 0 24px 70px color-mix(in srgb, var(--app-accent) 15%, transparent);
  transform: translateY(-3px);
}

.app-discovery-card__content {
  position: relative;
  z-index: 1;
  display: flex;
  min-height: 19rem;
  flex-direction: column;
  gap: 1rem;
  padding: 1.35rem;
}

.app-discovery-card__header {
  display: flex;
  align-items: center;
  gap: 0.9rem;
}

.app-discovery-card__heading {
  min-width: 0;
}

.app-discovery-card__eyebrow {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--ui-text-muted);
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.app-discovery-card__featured {
  border-radius: 999px;
  padding: 0.12rem 0.45rem;
  background: color-mix(in srgb, var(--app-accent) 16%, transparent);
  color: var(--app-accent);
  letter-spacing: normal;
}

.app-discovery-card__title {
  overflow: hidden;
  margin-top: 0.2rem;
  font-size: 1.12rem;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-discovery-card__title a:focus-visible,
.app-discovery-card__actions a:focus-visible {
  border-radius: 0.35rem;
  outline: 2px solid var(--app-accent);
  outline-offset: 3px;
}

.app-discovery-card__description {
  display: -webkit-box;
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 0.925rem;
  line-height: 1.75;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.app-discovery-card__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.app-discovery-card__tags li {
  border: 1px solid color-mix(in srgb, var(--app-accent) 18%, var(--ui-border));
  border-radius: 999px;
  padding: 0.22rem 0.55rem;
  background: color-mix(in srgb, var(--app-accent) 6%, transparent);
  color: var(--ui-text-muted);
  font-size: 0.72rem;
}

.app-discovery-card__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-top: auto;
  font-size: 0.82rem;
  font-weight: 600;
}

.app-discovery-card__detail-link,
.app-discovery-card__external-link {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}

.app-discovery-card__detail-link {
  color: var(--app-accent);
}

.app-discovery-card__external-link {
  color: var(--ui-text-muted);
}

@media (prefers-reduced-motion: reduce) {
  .app-discovery-card {
    transition: none;
  }

  .app-discovery-card:hover,
  .app-discovery-card:focus-within {
    transform: none;
  }
}
</style>
