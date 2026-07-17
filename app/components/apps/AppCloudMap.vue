<script setup lang="ts">
import type { ExplorerApp } from '~/types/app-explorer'
import { computed, shallowRef } from 'vue'
import { explorerCategories } from '~/config/app-explorer'
import { buildCloudRoutes, layoutCloudApps } from '~/utils/app-cloud-layout'
import SkyScene from '../SkyScene.vue'
import AppCloudRoutes from './AppCloudRoutes.vue'
import AppExplorerIcon from './AppExplorerIcon.vue'

const props = withDefaults(defineProps<{
  apps: ExplorerApp[]
  reducedMotion?: boolean
}>(), {
  reducedMotion: false,
})

defineEmits<{
  scrollToGrid: []
}>()

const colorMode = useColorMode()
const activeSlug = shallowRef<string | null>(null)
const skyTheme = computed(() => colorMode.value === 'dark' ? 'dark' : 'light')
const islands = computed(() => layoutCloudApps(props.apps))
const routes = computed(() => buildCloudRoutes(islands.value))
const visibleCategoryIds = computed(() => new Set(props.apps.map(app => app.category)))
const visibleCategories = computed(() => explorerCategories.filter(category => visibleCategoryIds.value.has(category.id)))
const activeApp = computed(() => {
  return props.apps.find(app => app.slug === activeSlug.value)
    ?? props.apps.find(app => app.featured)
    ?? props.apps[0]
})

function activate(slug: string) {
  activeSlug.value = slug
}
</script>

<template>
  <section class="app-cloud-map" aria-label="应用云图">
    <SkyScene :theme="skyTheme" clouds="mini" class="app-cloud-map__sky" />
    <div class="app-cloud-map__veil" aria-hidden="true" />

    <AppCloudRoutes :routes="routes" :reduced-motion="reducedMotion" />

    <span
      v-for="category in visibleCategories"
      :key="category.id"
      class="app-cloud-map__category"
      :style="{ left: `${category.anchor.x}%`, top: `${category.anchor.y}%` }"
      aria-hidden="true"
    >{{ category.label }}</span>

    <div class="app-cloud-map__core" aria-hidden="true">
      <UIcon name="i-lucide-cloud-sun" />
      <span>云乐坊</span>
    </div>

    <NuxtLink
      v-for="island in islands"
      :key="island.app.slug"
      :to="`/apps/${island.app.slug}`"
      :data-testid="`cloud-island-${island.app.slug}`"
      class="app-cloud-map__island"
      :class="[
        `app-cloud-map__island--${island.size}`,
        { 'app-cloud-map__island--active': activeApp?.slug === island.app.slug },
      ]"
      :style="{
        '--app-accent': island.app.accent,
        'left': `${island.x}%`,
        'top': `${island.y}%`,
      }"
      :aria-label="`探索应用：${island.app.name}`"
      @focus="activate(island.app.slug)"
      @mouseenter="activate(island.app.slug)"
    >
      <AppExplorerIcon :app="island.app" />
      <span class="app-cloud-map__island-name">{{ island.app.name }}</span>
    </NuxtLink>

    <aside v-if="activeApp" data-testid="cloud-preview" class="app-cloud-map__preview" aria-live="polite">
      <span>{{ activeApp.categoryLabel }}</span>
      <strong>{{ activeApp.name }}</strong>
      <p>{{ activeApp.description || '一朵等待探索的应用云。' }}</p>
    </aside>

    <UButton
      class="app-cloud-map__browse"
      label="浏览全部应用"
      icon="i-lucide-layout-grid"
      color="neutral"
      variant="solid"
      @click="$emit('scrollToGrid')"
    />
  </section>
</template>

<style scoped>
.app-cloud-map {
  position: relative;
  isolation: isolate;
  min-height: 34rem;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 1.75rem;
  background: #76b8ed;
  box-shadow:
    0 30px 80px -35px color-mix(in srgb, var(--ylf-dopa-blue) 62%, transparent),
    inset 0 1px rgba(255, 255, 255, 0.72);
}

.app-cloud-map__sky {
  z-index: 0;
}

.app-cloud-map__veil {
  position: absolute;
  z-index: 1;
  background:
    radial-gradient(circle at 50% 48%, rgba(255, 255, 255, 0.08), transparent 25%),
    linear-gradient(180deg, rgba(16, 55, 108, 0.1), rgba(13, 40, 88, 0.22));
  inset: 0;
  pointer-events: none;
}

.app-cloud-map__category {
  position: absolute;
  z-index: 3;
  transform: translate(-50%, -3.4rem);
  color: rgba(255, 255, 255, 0.68);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-shadow: 0 1px 5px rgba(13, 40, 88, 0.4);
  text-transform: uppercase;
}

.app-cloud-map__core {
  position: absolute;
  z-index: 4;
  display: grid;
  width: 5.5rem;
  height: 4rem;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.7);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.82);
  box-shadow: 0 16px 40px rgba(11, 61, 118, 0.25);
  color: #155a95;
  font-size: 0.65rem;
  font-weight: 800;
  left: 50%;
  top: 48%;
  transform: translate(-50%, -50%);
}

.app-cloud-map__core::before,
.app-cloud-map__core::after {
  position: absolute;
  z-index: -1;
  border-radius: 50%;
  background: inherit;
  content: '';
}

.app-cloud-map__core::before {
  width: 2.7rem;
  height: 2.7rem;
  left: 0.4rem;
  top: -1rem;
}

.app-cloud-map__core::after {
  width: 3.2rem;
  height: 3.2rem;
  right: 0.35rem;
  top: -1.3rem;
}

.app-cloud-map__core :deep(svg) {
  width: 1.45rem;
  height: 1.45rem;
}

.app-cloud-map__island {
  position: absolute;
  z-index: 5;
  display: grid;
  justify-items: center;
  gap: 0.25rem;
  transform: translate(-50%, -50%);
  transition:
    filter 180ms ease,
    transform 180ms ease;
}

.app-cloud-map__island :deep(.app-explorer-icon) {
  width: 2.9rem;
  height: 2.9rem;
  border-color: rgba(255, 255, 255, 0.74);
  background-color: rgba(255, 255, 255, 0.88);
  box-shadow: 0 10px 25px rgba(12, 56, 105, 0.24);
}

.app-cloud-map__island--featured :deep(.app-explorer-icon) {
  width: 3.55rem;
  height: 3.55rem;
}

.app-cloud-map__island:hover,
.app-cloud-map__island:focus-visible,
.app-cloud-map__island--active {
  z-index: 7;
  filter: drop-shadow(0 0 12px color-mix(in srgb, var(--app-accent) 55%, white));
  outline: none;
  transform: translate(-50%, -50%) scale(1.08);
}

.app-cloud-map__island:focus-visible :deep(.app-explorer-icon) {
  outline: 3px solid white;
  outline-offset: 3px;
}

.app-cloud-map__island-name {
  max-width: 6.5rem;
  overflow: hidden;
  border-radius: 999px;
  padding: 0.12rem 0.42rem;
  background: rgba(16, 48, 88, 0.58);
  color: white;
  font-size: 0.58rem;
  font-weight: 700;
  text-overflow: ellipsis;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
  white-space: nowrap;
}

.app-cloud-map__preview {
  position: absolute;
  z-index: 8;
  width: min(18rem, calc(100% - 2rem));
  border: 1px solid rgba(255, 255, 255, 0.48);
  border-radius: 1rem;
  padding: 0.75rem 0.9rem;
  background: rgba(8, 35, 76, 0.64);
  box-shadow: 0 12px 32px rgba(8, 35, 76, 0.18);
  backdrop-filter: blur(14px);
  bottom: 1rem;
  color: white;
  left: 1rem;
}

.app-cloud-map__preview span {
  display: block;
  color: rgba(255, 255, 255, 0.68);
  font-size: 0.62rem;
  letter-spacing: 0.08em;
}

.app-cloud-map__preview strong {
  display: block;
  margin-top: 0.15rem;
  font-size: 0.9rem;
}

.app-cloud-map__preview p {
  overflow: hidden;
  margin-top: 0.2rem;
  color: rgba(255, 255, 255, 0.76);
  font-size: 0.7rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-cloud-map__browse {
  position: absolute;
  z-index: 8;
  right: 1rem;
  bottom: 1rem;
}

@media (max-width: 639px) {
  .app-cloud-map {
    min-height: 31rem;
  }

  .app-cloud-map__category,
  .app-cloud-map__island-name {
    display: none;
  }

  .app-cloud-map__island :deep(.app-explorer-icon) {
    width: 2.5rem;
    height: 2.5rem;
  }

  .app-cloud-map__island--featured :deep(.app-explorer-icon) {
    width: 3rem;
    height: 3rem;
  }

  .app-cloud-map__preview {
    right: 1rem;
    width: auto;
    bottom: 4.5rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .app-cloud-map__island {
    transition: none;
  }
}
</style>
