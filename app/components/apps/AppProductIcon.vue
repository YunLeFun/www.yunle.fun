<script setup lang="ts">
import type { SsoExplorerApp } from '~/types/app-explorer'
import { computed, shallowRef, watch } from 'vue'
import { appIcons, registryAppIconIds } from '~/config/app-icons'

const props = defineProps<{
  app: Pick<SsoExplorerApp, 'appId' | 'logoUrl' | 'fallbackMark'>
}>()

const appIcon = computed(() => appIcons[props.app.appId])
const usesRegistryIcon = computed(() => registryAppIconIds.has(props.app.appId))
const primaryIconSrc = computed(() => usesRegistryIcon.value ? props.app.logoUrl : appIcon.value ?? props.app.logoUrl)
const usesFallback = shallowRef(false)
const iconSrc = computed(() => usesFallback.value ? appIcon.value : primaryIconSrc.value)
const isMark = computed(() => !appIcon.value)
const logoFailed = shallowRef(false)

watch([primaryIconSrc, appIcon], () => {
  usesFallback.value = false
  logoFailed.value = false
})

function handleLogoError() {
  if (!usesFallback.value && appIcon.value && primaryIconSrc.value !== appIcon.value)
    usesFallback.value = true
  else
    logoFailed.value = true
}
</script>

<template>
  <span class="app-product-icon" :class="{ 'app-product-icon--mark': isMark }" aria-hidden="true">
    <img v-if="!logoFailed" :src="iconSrc" alt="" loading="lazy" width="64" height="64" @error="handleLogoError">
    <span v-else>{{ app.fallbackMark }}</span>
  </span>
</template>

<style scoped>
.app-product-icon {
  position: relative;
  display: grid;
  width: var(--app-icon-size, 4rem);
  height: var(--app-icon-size, 4rem);
  flex: none;
  place-items: center;
  overflow: hidden;
  border-radius: 22%;
  background: var(--ylf-sso-cloud-top);
  box-shadow: 0 4px 10px -3px color-mix(in srgb, var(--ylf-shadow-color) 16%, transparent);
  color: var(--ylf-sso-ink);
  font-size: 0.85rem;
  font-weight: 700;
}

.app-product-icon::after {
  position: absolute;
  inset: 0;
  border: 1px solid color-mix(in srgb, var(--ylf-sso-ink) 6%, transparent);
  border-radius: inherit;
  pointer-events: none;
  content: '';
}

.app-product-icon img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.app-product-icon--mark img {
  width: 80%;
  height: 80%;
}
</style>
