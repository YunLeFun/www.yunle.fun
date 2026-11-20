<script setup lang="ts">
import type { MDCRoot } from '@nuxtjs/mdc'
import { markdownProseComponents } from '#build/markdown-prose'

defineProps<{
  body: MDCRoot
  data?: Record<string, unknown>
}>()

// MDC resolves nested slot content from its rendering context, so register Prose
// on this Nuxt app when the first Markdown renderer is needed.
const { vueApp } = useNuxtApp()
for (const [name, component] of Object.entries(markdownProseComponents)) {
  if (!vueApp.component(name))
    vueApp.component(name, component)
}
</script>

<template>
  <MDCRenderer :body="body" :data="data" />
</template>
