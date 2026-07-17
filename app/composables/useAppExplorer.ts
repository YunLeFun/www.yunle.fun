import type { Ref } from 'vue'
import type { AppRecord } from '~/types/app'
import type { ExplorerCategoryFilter } from '~/types/app-explorer'
import { computed, shallowRef } from 'vue'
import {
  filterExplorerApps,
  getExplorerCategories,
  normalizeExplorerApps,
} from '~/utils/app-explorer'

export function useAppExplorer(apps: Ref<AppRecord[]>) {
  const query = shallowRef('')
  const selectedCategory = shallowRef<ExplorerCategoryFilter>('all')

  const normalizedApps = computed(() => normalizeExplorerApps(apps.value))
  const filteredApps = computed(() => filterExplorerApps(
    normalizedApps.value,
    query.value,
    selectedCategory.value,
  ))
  const categories = computed(() => getExplorerCategories(normalizedApps.value))

  function clearFilters() {
    query.value = ''
    selectedCategory.value = 'all'
  }

  return {
    query,
    selectedCategory,
    normalizedApps,
    filteredApps,
    categories,
    clearFilters,
  }
}
