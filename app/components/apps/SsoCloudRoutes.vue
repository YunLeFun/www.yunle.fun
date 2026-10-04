<script setup lang="ts">
import type { SsoExplorerApp } from '~/types/app-explorer'
import { computed, useId } from 'vue'

const props = withDefaults(defineProps<{
  apps: SsoExplorerApp[]
  activeAppId?: string | null
  reducedMotion?: boolean
}>(), { activeAppId: null, reducedMotion: false })

const gradientId = `sso-cloud-route-gradient-${useId()}`
const activeApp = computed(() => props.apps.find(app => app.appId === props.activeAppId))

function routePath(app: SsoExplorerApp) {
  const x = app.position.x
  const y = app.position.y + 0.85
  const dx = x - 50
  const dy = y - 50
  return `M 50 50 C ${50 + dx * 0.2} ${50 + dy * 0.5} ${x - dx * 0.18} ${y - dy * 0.12} ${x} ${y}`
}
</script>

<template>
  <svg
    class="sso-cloud-routes"
    viewBox="0 0 100 100"
    preserveAspectRatio="none"
    aria-hidden="true"
    data-testid="sso-cloud-routes"
    :style="{ '--route-accent': activeApp?.accent || 'var(--ui-primary)' }"
  >
    <defs>
      <linearGradient :id="gradientId" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="var(--route-accent)" stop-opacity="0" />
        <stop offset="0.5" stop-color="var(--route-accent)" />
        <stop offset="1" stop-color="var(--route-accent)" stop-opacity="0" />
      </linearGradient>
    </defs>

    <path
      v-for="app in apps"
      :key="app.appId"
      :d="routePath(app)"
      class="sso-cloud-routes__edge"
      vector-effect="non-scaling-stroke"
    />

    <template v-if="activeApp">
      <path
        :d="routePath(activeApp)"
        class="sso-cloud-routes__active"
        vector-effect="non-scaling-stroke"
      />
      <path
        v-if="!reducedMotion"
        :key="activeApp.appId"
        :d="routePath(activeApp)"
        class="sso-cloud-routes__beam"
        :stroke="`url(#${gradientId})`"
        pathLength="1"
        vector-effect="non-scaling-stroke"
      />
    </template>
  </svg>
</template>

<style scoped>
.sso-cloud-routes {
  position: absolute;
  z-index: 1;
  width: 100%;
  height: 100%;
  inset: 0;
  pointer-events: none;
}

.sso-cloud-routes path {
  fill: none;
  stroke-linecap: round;
}

.sso-cloud-routes__edge {
  stroke: color-mix(in srgb, var(--ui-primary) 19%, transparent);
  stroke-width: 1.1;
}

.sso-cloud-routes__active {
  stroke: var(--route-accent);
  stroke-width: 1.8;
}

.sso-cloud-routes__beam {
  stroke-width: 3;
  stroke-dasharray: 0.12 0.88;
  animation: sso-cloud-beam 1.3s ease-out 1;
}

@keyframes sso-cloud-beam {
  from {
    stroke-dashoffset: 0.88;
  }
  to {
    stroke-dashoffset: -0.12;
  }
}

@media (prefers-reduced-motion: reduce) {
  .sso-cloud-routes__beam {
    animation: none;
  }
}
</style>
