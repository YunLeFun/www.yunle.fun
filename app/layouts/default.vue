<script setup lang="ts">
import CloudJourneySky from '~/components/clouds/CloudJourneySky.vue'

const route = useRoute()
const hasSky = computed(() => route.path === '/' || route.path === '/explore')
</script>

<template>
  <div>
    <a
      href="#main-content"
      class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-foreground focus:ring-2 focus:ring-ring"
    >
      跳至主要内容
    </a>

    <AppHeader />
    <SiteAnnouncement />

    <main id="main-content" :class="{ 'site-main--sky': hasSky }" tabindex="-1">
      <CloudJourneySky />
      <div class="site-main__content">
        <slot />
      </div>
    </main>

    <AppFooter />
  </div>
</template>

<style scoped>
.site-main--sky {
  position: relative;
  isolation: isolate;
}
.site-main--sky > .site-main__content {
  position: relative;
  z-index: 1;
}
</style>
