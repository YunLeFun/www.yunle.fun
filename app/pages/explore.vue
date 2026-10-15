<script setup lang="ts">
import type { AppRecord } from '~/types/app'
import { computed, onMounted, shallowRef, useTemplateRef } from 'vue'
import AppDiscoveryGrid from '~/components/apps/AppDiscoveryGrid.vue'
import AppDiscoveryToolbar from '~/components/apps/AppDiscoveryToolbar.vue'
import AppExplorerHero from '~/components/apps/AppExplorerHero.vue'
import HomeCloud from '~/components/home/HomeCloud.vue'
import { useTcbAuthSession } from '~/composables/auth/useAuthSession'
import { useAppExplorer } from '~/composables/useAppExplorer'
import { useSkyParallax } from '~/composables/useSkyParallax'

const apps = shallowRef<AppRecord[]>([])
const loading = shallowRef(true)
const error = shallowRef<string | null>(null)
const gridSection = useTemplateRef<HTMLElement>('gridSection')
const page = shallowRef<HTMLElement | null>(null)
useSkyParallax(page)

// 顶部天空里的几朵云：远处偏淡、近处清晰，跟随鼠标轻轻错位。
const skyClouds = [
  { name: 'far', shape: 'wisp', haze: 0.55, depth: 0.25 },
  { name: 'puff', shape: 'puff', haze: 0.3, depth: 0.5 },
  { name: 'near', shape: 'heap', haze: 0, depth: 0.9 },
  { name: 'low', shape: 'bank', haze: 0.12, depth: 0.7 },
] as const
const { getOfficialApps } = useApps()
const { authReady, checkAuthStatus } = useTcbAuthSession()
const {
  query,
  selectedCategory,
  normalizedApps,
  filteredApps,
  categories,
  clearFilters,
} = useAppExplorer(apps)

const hasFilters = computed(() => Boolean(query.value) || selectedCategory.value !== 'all')

useSeoMeta({
  title: '云端应用图谱',
  description: '探索云乐坊公开的创意应用，在云图与应用列表中发现下一朵有趣的云。',
  ogTitle: '云端应用图谱 · 云乐坊',
  ogDescription: '沿着云路漫游，发现云乐坊公开的创意应用。',
})

async function loadApps() {
  loading.value = true
  error.value = null

  try {
    if (!authReady.value)
      await checkAuthStatus()

    const result = await getOfficialApps()
    apps.value = result.filter(app => app.isPublic)
  }
  catch {
    error.value = '云端应用暂时走散了，请稍后重试。'
  }
  finally {
    loading.value = false
  }
}

function scrollToGrid() {
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  gridSection.value?.scrollIntoView({
    behavior: reducedMotion ? 'auto' : 'smooth',
    block: 'start',
  })
}

onMounted(loadApps)
</script>

<template>
  <div ref="page" class="app-explorer-page">
    <div class="app-explorer-page__sky" aria-hidden="true">
      <SkyScene clouds="none" :sun="false" />
      <span class="app-explorer-page__atmosphere" />
      <HomeCloud
        v-for="cloud in skyClouds"
        :key="cloud.name"
        :shape="cloud.shape"
        class="app-explorer-page__cloud"
        :class="`app-explorer-page__cloud--${cloud.name}`"
        :style="{ '--haze': cloud.haze, '--depth': cloud.depth }"
      />
      <span class="app-explorer-page__fade" />
    </div>

    <AppContainer class="app-explorer-page__container">
      <AppExplorerHero
        :apps="normalizedApps"
        :loading="loading"
        @scroll-to-grid="scrollToGrid"
      />

      <section ref="gridSection" class="app-explorer-page__discovery" aria-labelledby="app-discovery-title">
        <header class="app-explorer-page__section-header">
          <div>
            <p>DISCOVER THE CLOUD</p>
            <h2 id="app-discovery-title">
              浏览全部应用
            </h2>
          </div>
          <span>{{ normalizedApps.length }} 朵应用云</span>
        </header>

        <AppDiscoveryToolbar
          v-model:query="query"
          :selected-category="selectedCategory"
          :categories="categories"
          :result-count="filteredApps.length"
          @update:category="selectedCategory = $event"
        />

        <AppDiscoveryGrid
          :apps="filteredApps"
          :loading="loading"
          :error="error"
          :has-filters="hasFilters"
          @retry="loadApps"
          @clear="clearFilters"
        />
      </section>
    </AppContainer>
  </div>
</template>

<style scoped>
.app-explorer-page {
  --explore-page-top: #e8f2fd;
  position: relative;
  isolation: isolate;
  /* clip 不会生成滚动容器，筛选栏的 sticky 才能生效。 */
  overflow-x: clip;
  min-height: 100vh;
  background: var(--ui-bg);
}

.dark .app-explorer-page {
  --explore-page-top: #1c1a3a;
}

/* 与首页同一片天：顶部是晴空 / 黄昏，向下沉入页面底色，而不是框在卡片里的横幅。 */
.app-explorer-page__sky {
  position: absolute;
  z-index: 0;
  inset: 0 0 auto;
  height: clamp(26rem, 52vw, 34rem);
  overflow: hidden;
  pointer-events: none;
  /* 底部用遮罩溶解进页面，而不是在某条水平线上换色。 */
  mask-image: linear-gradient(#000 55%, transparent);
}

.app-explorer-page__atmosphere {
  position: absolute;
  inset: 0;
  background: linear-gradient(100deg, rgb(15 55 114 / 42%), rgb(25 76 132 / 10%) 55%, transparent 80%);
}

.dark .app-explorer-page__atmosphere {
  background: linear-gradient(100deg, rgb(24 22 65 / 55%), rgb(46 34 84 / 16%) 55%, transparent 80%);
}

.app-explorer-page__cloud {
  position: absolute;
  translate: calc(var(--px, 0) * var(--depth) * 20px)
    calc(var(--py, 0) * var(--depth) * 10px + var(--scroll, 0) * var(--depth) * -0.25px);
  transition: translate 1000ms var(--ylf-ease-standard);
  animation: explore-cloud-enter 1400ms var(--ylf-ease-spring) backwards;
}

.app-explorer-page__cloud--far {
  top: 10%;
  right: 30%;
  width: clamp(160px, 18vw, 260px);
  filter: blur(1.6px);
  opacity: 0.7;
}

.app-explorer-page__cloud--puff {
  top: 4%;
  right: 4%;
  width: clamp(150px, 15vw, 220px);
  filter: blur(0.8px);
  animation-delay: 120ms;
}

.app-explorer-page__cloud--near {
  top: 40%;
  right: -8%;
  width: clamp(320px, 34vw, 500px);
  animation-delay: 60ms;
}

.app-explorer-page__cloud--low {
  bottom: 18%;
  left: -8%;
  width: clamp(300px, 32vw, 460px);
  opacity: 0.85;
}

.app-explorer-page__fade {
  position: absolute;
  inset: auto 0 0;
  height: 50%;
  background: linear-gradient(to bottom, transparent, var(--explore-page-top));
}

.app-explorer-page__container {
  position: relative;
  z-index: 1;
  padding-top: clamp(2.5rem, 6vw, 4.5rem);
  padding-bottom: 6rem;
}

@keyframes explore-cloud-enter {
  from {
    opacity: 0;
    transform: translateX(calc(var(--depth) * 80px)) scale(0.94);
  }
}

@media (max-width: 767px) {
  .app-explorer-page__cloud--near {
    top: auto;
    right: -30%;
    bottom: 26%;
    width: 300px;
  }

  .app-explorer-page__cloud--far {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .app-explorer-page__cloud {
    transition: none;
    animation: none;
  }
}

.app-explorer-page__discovery {
  display: grid;
  scroll-margin-top: 5rem;
  gap: 1.5rem;
  margin-top: clamp(4rem, 9vw, 7rem);
}

.app-explorer-page__section-header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 1rem;
}

.app-explorer-page__section-header p {
  color: var(--ui-primary);
  font-size: 0.68rem;
  font-weight: 800;
  letter-spacing: 0.14em;
}

.app-explorer-page__section-header h2 {
  margin-top: 0.25rem;
  font-size: clamp(1.7rem, 4vw, 2.6rem);
  font-weight: 850;
  letter-spacing: -0.035em;
}

.app-explorer-page__section-header > span {
  color: var(--ui-text-muted);
  font-size: 0.82rem;
  white-space: nowrap;
}
</style>
