<script setup lang="ts">
import type { AppRecord } from '~/types/app'
import { computed, onMounted, shallowRef, useTemplateRef } from 'vue'
import AppDiscoveryGrid from '~/components/apps/AppDiscoveryGrid.vue'
import AppDiscoveryToolbar from '~/components/apps/AppDiscoveryToolbar.vue'
import AppExplorerHero from '~/components/apps/AppExplorerHero.vue'
import { useAppExplorer } from '~/composables/useAppExplorer'
import { usePublicApps } from '~/composables/usePublicApps'

const apps = shallowRef<AppRecord[]>([])
const loading = shallowRef(true)
const error = shallowRef<string | null>(null)
const gridSection = useTemplateRef<HTMLElement>('gridSection')

const nuxtApp = useNuxtApp()
const { getOfficialApps } = usePublicApps()
// 全局中间件会先恢复会话（匿名访客直接标记就绪）；只有它尚未就绪时才按需加载认证 SDK，
// 避免公开应用页把 CloudBase SDK 打进首屏 chunk。
const authReady = useState<boolean>('auth_ready', () => false)
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
  title: '浏览应用',
  description: '探索云乐坊的创作工具、小游戏和日常应用，按分类或关键词找到你想用的应用。',
  ogTitle: '浏览应用 · 云乐坊',
  ogDescription: '乘云海列车发现应用，或按分类和关键词浏览云乐坊的公开应用。',
})

async function loadApps() {
  loading.value = true
  error.value = null

  try {
    if (!authReady.value) {
      const { useTcbAuthSession } = await import('~/composables/auth/useAuthSession')
      await nuxtApp.runWithContext(() => useTcbAuthSession().checkAuthStatus())
    }

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
  <div class="app-explorer-page">
    <AppContainer class="app-explorer-page__container">
      <AppExplorerHero
        :apps="normalizedApps"
        :loading="loading"
        @scroll-to-grid="scrollToGrid"
      />

      <section ref="gridSection" class="app-explorer-page__discovery" aria-labelledby="app-discovery-title">
        <header class="app-explorer-page__section-header">
          <h2 id="app-discovery-title">
            全部应用
          </h2>
          <span v-if="!loading && !error">{{ normalizedApps.length }} 个应用</span>
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
  position: relative;
  isolation: isolate;
  /* clip 不会生成滚动容器，筛选栏的 sticky 才能生效。 */
  overflow-x: clip;
  min-height: 100vh;
  background: transparent;
}

.app-explorer-page__container {
  position: relative;
  z-index: 1;
  padding-top: clamp(2.5rem, 6vw, 4.5rem);
  padding-bottom: 6rem;
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

.app-explorer-page__section-header h2 {
  font-family: var(--ylf-font-heading);
  font-size: var(--ylf-type-headline);
  font-weight: 650;
  letter-spacing: -0.01em;
}

.app-explorer-page__section-header > span {
  color: var(--ui-text-muted);
  font-size: 0.82rem;
  white-space: nowrap;
}
</style>
