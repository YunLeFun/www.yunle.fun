<script setup lang="ts">
import AppDetailPage from '~/components/apps/AppDetailPage.vue'

definePageMeta({ layout: 'default', path: '/u/:owner/apps/:slug' })
</script>

<template>
  <AppDetailPage :key="$route.path" />
</template>
