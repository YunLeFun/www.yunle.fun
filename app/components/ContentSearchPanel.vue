<script setup lang="ts">
import type { ContentNavigationItem } from '@nuxt/content'

interface SearchLink {
  label: string
  icon?: string
  to: string
  children?: SearchLink[]
}

const props = defineProps<{
  navigation?: ContentNavigationItem[] | null
  links?: SearchLink[]
}>()

const requestedOpen = useState('content_search_requested_open', () => false)
const { open } = useContentSearch()
const { navigation: loadedNavigation, ensureNavigation } = useNavigation()

const resolvedNavigation = computed(() => {
  return props.navigation?.length ? props.navigation : loadedNavigation.value
})

const { data: files, execute, status } = useLazyAsyncData(
  'content-search-docs',
  () => queryCollectionSearchSections('docs'),
  {
    immediate: false,
    server: false,
  },
)

watch(
  requestedOpen,
  (value) => {
    if (!value)
      return

    open.value = true
    requestedOpen.value = false
  },
  { immediate: true },
)

onMounted(() => {
  void ensureNavigation()

  if (status.value === 'idle' || status.value === 'error')
    void execute()
})
</script>

<template>
  <LazyUContentSearch
    :files="files || []"
    shortcut="meta_k"
    :navigation="resolvedNavigation"
    :links="props.links || []"
    :loading="status === 'pending'"
    :fuse="{ resultLimit: 42 }"
  />
</template>
