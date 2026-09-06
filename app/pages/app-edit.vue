<script setup lang="ts">
import AppEditPage from '~/components/apps/AppEditPage.vue'

definePageMeta({ layout: 'default', path: '/u/:owner/apps/:slug/edit' })
</script>

<template>
  <AppEditPage :key="$route.path" />
</template>
