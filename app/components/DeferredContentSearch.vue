<script setup lang="ts">
import type { ContentNavigationItem } from '@nuxt/content'

interface SearchLink {
  label: string
  icon?: string
  to: string
  children?: SearchLink[]
}

defineProps<{
  navigation?: ContentNavigationItem[] | null
  links?: SearchLink[]
}>()

const route = useRoute()
const requestedOpen = useState('content_search_requested_open', () => false)
const shouldMount = shallowRef(false)

const shortcutConfig = computed(() => {
  if (shouldMount.value)
    return {}

  return {
    meta_k: {
      usingInput: true,
      handler: () => {
        requestOpen()
      },
    },
  }
})

let cancelIdleMount: (() => void) | undefined

function mountSearch() {
  shouldMount.value = true
  cancelIdleMount?.()
  cancelIdleMount = undefined
}

function requestOpen() {
  requestedOpen.value = true
  mountSearch()
}

function scheduleIdleMount() {
  if (shouldMount.value || cancelIdleMount)
    return

  if (typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(mountSearch, { timeout: 3000 })
    cancelIdleMount = () => window.cancelIdleCallback(handle)
    return
  }

  const handle = window.setTimeout(mountSearch, 1500)
  cancelIdleMount = () => window.clearTimeout(handle)
}

defineShortcuts(shortcutConfig)

watch(requestedOpen, (value) => {
  if (value)
    mountSearch()
})

onMounted(() => {
  if (route.path.startsWith('/docs'))
    scheduleIdleMount()
})

watch(
  () => route.path,
  (path) => {
    if (path.startsWith('/docs'))
      scheduleIdleMount()
  },
)

onBeforeUnmount(() => {
  cancelIdleMount?.()
})
</script>

<template>
  <ClientOnly>
    <LazyContentSearchPanel
      v-if="shouldMount"
      :navigation="navigation || []"
      :links="links || []"
    />
  </ClientOnly>
</template>
