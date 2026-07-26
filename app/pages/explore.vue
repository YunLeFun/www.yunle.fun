<script setup lang="ts">
import type { AppRecord } from '~/types/app'
import { computed, onMounted, shallowRef, useTemplateRef } from 'vue'
import AppDiscoveryGrid from '~/components/apps/AppDiscoveryGrid.vue'
import AppDiscoveryToolbar from '~/components/apps/AppDiscoveryToolbar.vue'
import AppExplorerHero from '~/components/apps/AppExplorerHero.vue'
import { useTcbAuthSession } from '~/composables/auth/useAuthSession'
import { useAppExplorer } from '~/composables/useAppExplorer'

const apps = shallowRef<AppRecord[]>([])
const loading = shallowRef(true)
const error = shallowRef<string | null>(null)
const gridSection = useTemplateRef<HTMLElement>('gridSection')
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
  <main class="app-explorer-page">
    <div class="app-explorer-page__glow app-explorer-page__glow--one" aria-hidden="true" />
    <div class="app-explorer-page__glow app-explorer-page__glow--two" aria-hidden="true" />

    <UContainer class="app-explorer-page__container">
      <AppExplorerHero
        :apps="normalizedApps"
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
    </UContainer>
  </main>
</template>

<style scoped>
.app-explorer-page {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  min-height: 100vh;
  background:
    radial-gradient(circle at 12% 12%, color-mix(in srgb, var(--ylf-dopa-cyan) 8%, transparent), transparent 28rem),
    radial-gradient(circle at 92% 38%, color-mix(in srgb, var(--ylf-dopa-violet) 7%, transparent), transparent 30rem),
    var(--ui-bg);
}

.app-explorer-page__container {
  position: relative;
  z-index: 1;
  padding-top: clamp(3rem, 8vw, 6rem);
  padding-bottom: 6rem;
}

.app-explorer-page__glow {
  position: absolute;
  z-index: 0;
  width: 24rem;
  height: 24rem;
  border-radius: 50%;
  filter: blur(80px);
  opacity: 0.12;
  pointer-events: none;
}

.app-explorer-page__glow--one {
  background: var(--ylf-dopa-cyan);
  left: -14rem;
  top: 45rem;
}

.app-explorer-page__glow--two {
  background: var(--ylf-dopa-violet);
  right: -15rem;
  top: 70rem;
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
  color: var(--ylf-dopa-cyan);
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
