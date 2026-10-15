<script setup lang="ts">
import type { ExplorerCategory, ExplorerCategoryFilter } from '~/types/app-explorer'
import { computed, shallowRef, useId } from 'vue'

const props = defineProps<{
  query: string
  selectedCategory: ExplorerCategoryFilter
  categories: ExplorerCategory[]
  resultCount: number
}>()

const emit = defineEmits<{
  'update:query': [value: string]
  'update:category': [value: ExplorerCategoryFilter]
}>()

const searchId = `app-search-${useId()}`
// 选中动效只在访客点过分类后播放，首屏默认选中的「全部」保持静止。
const touched = shallowRef(false)

function selectCategory(value: ExplorerCategoryFilter) {
  touched.value = true
  emit('update:category', value)
}
const hasActiveFilter = computed(() => Boolean(props.query) || props.selectedCategory !== 'all')

function updateQuery(value: string | number | null | undefined) {
  emit('update:query', String(value ?? ''))
}

function clearFilters() {
  emit('update:query', '')
  emit('update:category', 'all')
}
</script>

<template>
  <section class="app-discovery-toolbar" aria-label="筛选应用">
    <div class="app-discovery-toolbar__search">
      <label :for="searchId" class="sr-only">搜索应用</label>
      <AppInput
        :id="searchId"
        :model-value="query"
        type="search"
        icon="i-lucide-search"
        size="xl"
        placeholder="搜索名称、介绍或标签"
        class="w-full"
        @update:model-value="updateQuery"
      />
    </div>

    <div class="app-discovery-toolbar__filters" :class="{ 'is-touched': touched }" aria-label="应用分类">
      <AppButton
        data-category="all"
        label="全部"
        :aria-pressed="selectedCategory === 'all'"
        :variant="selectedCategory === 'all' ? 'solid' : 'soft'"
        :color="selectedCategory === 'all' ? 'primary' : 'neutral'"
        size="sm"
        class="app-discovery-toolbar__chip"
        @click="selectCategory('all')"
      />
      <AppButton
        v-for="category in categories"
        :key="category.id"
        :data-category="category.id"
        :label="category.label"
        :icon="category.icon"
        :aria-pressed="selectedCategory === category.id"
        :variant="selectedCategory === category.id ? 'solid' : 'soft'"
        :color="selectedCategory === category.id ? 'primary' : 'neutral'"
        size="sm"
        class="app-discovery-toolbar__chip"
        @click="selectCategory(category.id)"
      />
    </div>

    <div class="app-discovery-toolbar__status">
      <span aria-live="polite">找到 {{ resultCount }} 个应用</span>
      <AppButton
        v-if="hasActiveFilter"
        label="清除筛选"
        icon="i-lucide-x"
        color="neutral"
        variant="ghost"
        size="xs"
        @click="clearFilters"
      />
    </div>
  </section>
</template>

<style scoped>
.app-discovery-toolbar {
  display: grid;
  gap: 1rem;
  padding: 1rem;
  border: 1px solid color-mix(in srgb, var(--ui-border) 75%, transparent);
  border-radius: 1.5rem;
  background: color-mix(in srgb, var(--ui-bg) 78%, transparent);
  box-shadow: 0 20px 60px color-mix(in srgb, var(--ylf-dopa-blue) 8%, transparent);
  backdrop-filter: blur(18px);
}

.app-discovery-toolbar__search {
  width: 100%;
}

.app-discovery-toolbar__filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.app-discovery-toolbar__status {
  display: flex;
  min-height: 2rem;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  color: var(--ui-text-muted);
  font-size: 0.875rem;
}

.app-discovery-toolbar__filters.is-touched .app-discovery-toolbar__chip[aria-pressed='true'] {
  animation: discovery-chip-pop 480ms var(--ylf-ease-spring);
}

@keyframes discovery-chip-pop {
  from {
    scale: 0.88;
  }
}

@media (prefers-reduced-motion: reduce) {
  .app-discovery-toolbar__filters.is-touched .app-discovery-toolbar__chip[aria-pressed='true'] {
    animation: none;
  }
}

@media (min-width: 768px) {
  /* 浏览长列表时筛选栏贴在页头下方，随时可以换分类。 */
  .app-discovery-toolbar {
    position: sticky;
    z-index: 10;
    top: 4.75rem;
    grid-template-columns: minmax(17rem, 0.9fr) minmax(0, 1.6fr);
    align-items: center;
    padding: 1.25rem;
  }

  .app-discovery-toolbar__status {
    grid-column: 1 / -1;
  }
}
</style>
